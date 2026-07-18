package users

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/analytics"
)

// OAuth : social login Google / Apple, flow authorization code entièrement
// côté serveur (redirections top-level, aucun SDK JS tiers — compatible CSP
// stricte). Le state anti-CSRF vit en Redis avec TTL (règle d'or #4), la
// session posée au callback est le même cookie que le login classique.
type OAuth struct {
	rdb       *redis.Client
	hc        *http.Client
	providers map[string]*oauthProvider
	names     []string // ordre d'affichage stable pour le front
}

// OAuthConfig : credentials par provider. Un provider n'est monté que si
// toute sa config est présente (et APIBaseURL, dont dérivent les redirect
// URIs déclarées dans les consoles Google/Apple).
type OAuthConfig struct {
	APIBaseURL string // ex: https://api.jolyne.ralys.ovh

	GoogleClientID     string
	GoogleClientSecret string

	AppleClientID   string // Services ID
	AppleTeamID     string
	AppleKeyID      string
	ApplePrivateKey string // PEM .p8
}

// NewOAuth construit le service. nil si aucun provider utilisable — le
// front (via HandleOAuthProviders) n'affiche alors aucun bouton.
func NewOAuth(rdb *redis.Client, cfg OAuthConfig, log *slog.Logger) *OAuth {
	if cfg.APIBaseURL == "" {
		return nil
	}
	base := strings.TrimRight(cfg.APIBaseURL, "/")
	redirectURI := func(provider string) string {
		return base + "/api/auth/oauth/" + provider + "/callback"
	}
	o := &OAuth{
		rdb:       rdb,
		hc:        &http.Client{Timeout: 10 * time.Second},
		providers: map[string]*oauthProvider{},
	}
	if cfg.GoogleClientID != "" && cfg.GoogleClientSecret != "" {
		o.providers["google"] = newGoogleProvider(
			cfg.GoogleClientID, cfg.GoogleClientSecret, redirectURI("google"))
		o.names = append(o.names, "google")
	}
	if cfg.AppleClientID != "" && cfg.AppleTeamID != "" &&
		cfg.AppleKeyID != "" && cfg.ApplePrivateKey != "" {
		p, err := newAppleProvider(cfg.AppleClientID, cfg.AppleTeamID,
			cfg.AppleKeyID, cfg.ApplePrivateKey, redirectURI("apple"))
		if err != nil {
			log.Warn("oauth apple désactivé", "err", err)
		} else {
			o.providers["apple"] = p
			o.names = append(o.names, "apple")
		}
	}
	if len(o.providers) == 0 {
		return nil
	}
	return o
}

// oauthState : contexte du flow, retrouvé au callback via le paramètre
// state. Le fingerprint permet de résoudre les amitiés en attente exactement
// comme le login classique (OnUserAuthenticated).
type oauthState struct {
	Provider    string `json:"p"`
	Fingerprint string `json:"fp"`
}

const oauthStateTTL = 10 * time.Minute

func (o *OAuth) saveState(ctx context.Context, state string, st oauthState) error {
	data, err := json.Marshal(st)
	if err != nil {
		return err
	}
	return o.rdb.Set(ctx, "oauth:state:"+state, data, oauthStateTTL).Err()
}

// consumeState : lecture destructrice (GETDEL) — un state ne sert qu'une
// fois, rejeu impossible.
func (o *OAuth) consumeState(ctx context.Context, state string) (oauthState, bool) {
	if state == "" {
		return oauthState{}, false
	}
	data, err := o.rdb.GetDel(ctx, "oauth:state:"+state).Bytes()
	if err != nil {
		return oauthState{}, false
	}
	var st oauthState
	if err := json.Unmarshal(data, &st); err != nil {
		return oauthState{}, false
	}
	return st, true
}

// HandleOAuthProviders : GET /api/auth/oauth/providers → {"providers":[...]}.
// Toujours 200 — liste vide si OAuth non configuré (le front masque les
// boutons au lieu de gérer un 503).
func (h *Handlers) HandleOAuthProviders(w http.ResponseWriter, _ *http.Request) {
	names := []string{}
	if h.OAuth != nil {
		names = h.OAuth.names
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"providers": names})
}

// HandleOAuthStart : GET /api/auth/oauth/{provider}/start?fp=… → 302 vers
// l'écran de consentement du provider.
func (h *Handlers) HandleOAuthStart(w http.ResponseWriter, r *http.Request) {
	p := h.provider(r)
	if p == nil {
		http.Error(w, "oauth disabled", http.StatusServiceUnavailable)
		return
	}
	// Anti-spam de states Redis (et d'allers-retours providers).
	if !h.allow(w, r, "oauth_ip", h.clientIP(r), 20, 5*time.Minute) {
		return
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	state := hex.EncodeToString(buf)
	st := oauthState{Provider: p.name, Fingerprint: strings.TrimSpace(r.URL.Query().Get("fp"))}
	if err := h.OAuth.saveState(r.Context(), state, st); err != nil {
		h.log().Error("oauth save state", "provider", p.name, "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	http.Redirect(w, r, p.authorizeURL(state), http.StatusFound)
}

// HandleOAuthCallback : retour du provider — GET+query (Google) ou POST+form
// (Apple, response_mode=form_post). Toutes les issues redirigent vers le
// front : `?oauth=ok`, `?oauth=error`, ou rien si l'utilisateur a annulé.
func (h *Handlers) HandleOAuthCallback(w http.ResponseWriter, r *http.Request) {
	p := h.provider(r)
	if p == nil {
		h.redirectApp(w, r, "")
		return
	}
	// Annulation par l'utilisateur (Google: access_denied, Apple:
	// user_cancelled_authorize) — retour silencieux à l'app.
	if r.FormValue("error") != "" {
		h.redirectApp(w, r, "")
		return
	}
	if !h.allowSilent(r, "oauth_cb_ip", h.clientIP(r), 30, 5*time.Minute) {
		h.redirectApp(w, r, "error")
		return
	}
	st, ok := h.OAuth.consumeState(r.Context(), r.FormValue("state"))
	if !ok || st.Provider != p.name {
		h.redirectApp(w, r, "error")
		return
	}
	code := r.FormValue("code")
	if code == "" {
		h.redirectApp(w, r, "error")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	claims, err := p.exchangeCode(ctx, h.OAuth.hc, code)
	if err != nil {
		h.log().Error("oauth exchange", "provider", p.name, "err", err)
		h.redirectApp(w, r, "error")
		return
	}
	if claims.Email == "" {
		h.redirectApp(w, r, "error")
		return
	}
	// Même séparation stricte admin/user que le signup classique.
	if h.IsAdminEmail != nil && h.IsAdminEmail(claims.Email) {
		h.redirectApp(w, r, "error")
		return
	}

	userID, created, err := h.Store.FindOrCreateByIdentity(
		ctx, p.name, claims.Sub, claims.Email, bool(claims.EmailVerified))
	if err != nil {
		// ErrEmailUnverified inclus : réponse générique, pas de détail qui
		// révélerait l'existence d'un compte pour cet email.
		if !errors.Is(err, ErrEmailUnverified) {
			h.log().Error("oauth find or create", "provider", p.name, "err", err)
		}
		h.redirectApp(w, r, "error")
		return
	}
	user, err := h.Store.GetByID(ctx, userID)
	if err != nil {
		h.log().Error("oauth get user", "provider", p.name, "err", err)
		h.redirectApp(w, r, "error")
		return
	}

	// Display name (nouveau compte uniquement — on n'écrase jamais un nom
	// choisi) : claims Google, ou champ `user` posté par Apple au premier
	// consentement. Best-effort comme au signup.
	if created && h.Profile != nil {
		if name := oauthDisplayName(claims, r.FormValue("user")); name != "" {
			if err := h.Profile.UpsertDisplayName(ctx, userID, name); err != nil {
				h.log().Warn("oauth display_name upsert failed", "err", err)
			}
		}
	}

	_ = h.Store.TouchLastSeen(ctx, userID)
	h.openSession(w, userID, user.SessionVersion)

	if st.Fingerprint != "" && h.OnUserAuthenticated != nil {
		go h.OnUserAuthenticated(context.Background(), userID, st.Fingerprint) //nolint:gosec // G118 : hook fire-and-forget, survit à la requête (voulu)
	}
	event := analytics.EventLogin
	if created {
		event = analytics.EventSignupCompleted
	}
	h.Tracker.Emit(analytics.Event{
		Name:   event,
		UserID: userID,
		AnonID: analytics.HashID(st.Fingerprint),
	})

	h.redirectApp(w, r, "ok")
}

// provider résout {provider} depuis le path. nil si OAuth désactivé ou
// provider inconnu/non configuré.
func (h *Handlers) provider(r *http.Request) *oauthProvider {
	if h.OAuth == nil {
		return nil
	}
	return h.OAuth.providers[r.PathValue("provider")]
}

// redirectApp : retour au front. 303 force un GET (le callback Apple est un
// POST cross-site). result vide = retour à la racine sans paramètre.
func (h *Handlers) redirectApp(w http.ResponseWriter, r *http.Request, result string) {
	url := strings.TrimRight(h.PublicURL, "/") + "/"
	if result != "" {
		url += "?oauth=" + result
	}
	http.Redirect(w, r, url, http.StatusSeeOther)
}

// oauthDisplayName : prénom depuis les claims (Google) ou le champ `user`
// JSON qu'Apple poste uniquement au premier consentement.
func oauthDisplayName(claims idTokenClaims, appleUser string) string {
	if name := claims.displayName(); name != "" {
		return name
	}
	if appleUser == "" {
		return ""
	}
	var u struct {
		Name struct {
			FirstName string `json:"firstName"`
		} `json:"name"`
	}
	if err := json.Unmarshal([]byte(appleUser), &u); err != nil {
		return ""
	}
	return strings.TrimSpace(u.Name.FirstName)
}
