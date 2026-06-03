package users

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/ralys/jolyne/backend/internal/mailer"
)

// Handlers regroupe les endpoints HTTP auth utilisateur (côté public) :
// signup / login (email+password) / verify-email / forgot+reset / me / logout.
//
// Profile (optionnel) : si présent, on stocke le display_name fourni au
// signup directement dans `user_profiles` — sans ça, l'utilisateur doit
// repasser par /account pour que ses futurs amis voient son nom.
type Handlers struct {
	Store               *Store
	Profile             ProfileWriter
	Mailer              *mailer.Mailer
	SessionSecret       []byte
	CookieDomain        string
	CookieSecure        bool
	PublicURL           string // ex: https://jolyne.ralys.ovh — racine front
	Log                 *slog.Logger
	OnUserAuthenticated func(ctx context.Context, userID int64, fingerprint string)
}

// ProfileWriter : sous-ensemble de profile.Store dont users a besoin.
// Abstraction pour éviter l'import cyclique vers le package profile (qui
// importe lui-même users via le middleware d'auth).
type ProfileWriter interface {
	UpsertDisplayName(ctx context.Context, userID int64, displayName string) error
}

func (h *Handlers) log() *slog.Logger {
	if h.Log != nil {
		return h.Log
	}
	return slog.Default()
}

// HandleSignup : POST /api/auth/signup {email, password} → 200 {user} + Set-Cookie.
// Crée le compte, envoie l'email de vérification, ouvre la session
// immédiatement (le user peut utiliser le service avant d'avoir cliqué
// le lien — un badge "vérifie ton email" reste affiché tant que pas vérifié).
func (h *Handlers) HandleSignup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"display_name"`
		Fingerprint string `json:"fingerprint"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024)).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	addr, err := mail.ParseAddress(strings.TrimSpace(body.Email))
	if err != nil || addr.Address == "" {
		http.Error(w, "invalid email", http.StatusBadRequest)
		return
	}
	if len(body.Password) < PasswordMinLen {
		http.Error(w, fmt.Sprintf("password too short (min %d)", PasswordMinLen), http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	hash, err := HashPassword(body.Password)
	if err != nil {
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	user, err := h.Store.Create(ctx, addr.Address, hash)
	if err != nil {
		if errors.Is(err, ErrAlreadyExists) {
			http.Error(w, "email already used", http.StatusConflict)
			return
		}
		h.log().Error("signup create", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}

	// Display name (pseudo visible par les futurs amis) : best-effort, on
	// ne bloque pas le signup si l'écriture profil échoue — l'utilisateur
	// pourra le ressaisir depuis /account.
	displayName := strings.TrimSpace(body.DisplayName)
	if displayName != "" && h.Profile != nil {
		if err := h.Profile.UpsertDisplayName(ctx, user.ID, displayName); err != nil {
			h.log().Warn("signup display_name upsert failed", "err", err)
		}
	}

	// Email de vérification, best-effort (un échec d'envoi ne bloque pas
	// le signup — l'utilisateur peut demander un nouveau lien plus tard).
	h.sendEmailLink(ctx, user, PurposeVerifyEmail, "/auth/verify")

	h.openSession(w, user.ID)

	if body.Fingerprint != "" && h.OnUserAuthenticated != nil {
		go h.OnUserAuthenticated(context.Background(), user.ID, body.Fingerprint)
	}

	h.writeUser(w, user)
}

// HandleLogin : POST /api/auth/login {email, password} → 200 {user} + Set-Cookie.
func (h *Handlers) HandleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		Fingerprint string `json:"fingerprint"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024)).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	user, err := h.Store.Login(ctx, body.Email, body.Password)
	if err != nil {
		// Toujours la même erreur → pas de leak sur l'existence du compte.
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	_ = h.Store.TouchLastSeen(ctx, user.ID)
	h.openSession(w, user.ID)

	if body.Fingerprint != "" && h.OnUserAuthenticated != nil {
		go h.OnUserAuthenticated(context.Background(), user.ID, body.Fingerprint)
	}

	h.writeUser(w, user)
}

// HandleVerifyEmail : POST /api/auth/verify-email {token} → 200 {user}.
// Marque email vérifié + ouvre une session (au cas où le user a cliqué
// depuis un autre navigateur). Si pas de session active, c'est ici qu'on
// la pose.
func (h *Handlers) HandleVerifyEmail(w http.ResponseWriter, r *http.Request) {
	token := readToken(r)
	if token == "" {
		http.Error(w, "token required", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	userID, err := h.Store.ConsumeToken(ctx, token, PurposeVerifyEmail)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}
	if err := h.Store.MarkVerified(ctx, userID); err != nil {
		h.log().Error("verify mark", "err", err)
	}
	user, err := h.Store.GetByID(ctx, userID)
	if err != nil {
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	h.openSession(w, userID)
	h.writeUser(w, user)
}

// HandleForgot : POST /api/auth/forgot {email} → 204. On envoie un mail
// de reset SI le compte existe ; on répond toujours 204 pour ne pas leak
// l'existence d'une adresse.
func (h *Handlers) HandleForgot(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024)).Decode(&body); err != nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	addr, err := mail.ParseAddress(strings.TrimSpace(body.Email))
	if err != nil || addr.Address == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	user, err := h.Store.GetByEmail(ctx, addr.Address)
	if err == nil {
		h.sendEmailLink(ctx, user, PurposePasswordReset, "/auth/reset")
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleReset : POST /api/auth/reset {token, password} → 200 {user} + Set-Cookie.
func (h *Handlers) HandleReset(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024)).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if len(body.Password) < PasswordMinLen {
		http.Error(w, fmt.Sprintf("password too short (min %d)", PasswordMinLen), http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	userID, err := h.Store.ConsumeToken(ctx, body.Token, PurposePasswordReset)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}
	hash, err := HashPassword(body.Password)
	if err != nil {
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	if err := h.Store.SetPassword(ctx, userID, hash); err != nil {
		h.log().Error("reset set", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	user, err := h.Store.GetByID(ctx, userID)
	if err != nil {
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	h.openSession(w, userID)
	h.writeUser(w, user)
}

// HandleLogout : POST /api/auth/logout → 204 + cookie expiré.
func (h *Handlers) HandleLogout(w http.ResponseWriter, r *http.Request) {
	h.setSessionCookie(w, "", -time.Hour)
	w.WriteHeader(http.StatusNoContent)
}

// HandleMe : GET /api/auth/me → 200 {user: {...}|null}.
// On renvoie 200 + user:null plutôt que 401 quand pas de session, pour
// que le DevTools ne flag pas l'appel bootstrap comme une erreur.
func (h *Handlers) HandleMe(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	cookie, err := r.Cookie(SessionCookieName)
	if err != nil {
		_ = json.NewEncoder(w).Encode(map[string]any{"user": nil})
		return
	}
	sess, err := VerifySession(cookie.Value, h.SessionSecret)
	if err != nil {
		_ = json.NewEncoder(w).Encode(map[string]any{"user": nil})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	user, err := h.Store.GetByID(ctx, sess.UserID)
	if err != nil {
		_ = json.NewEncoder(w).Encode(map[string]any{"user": nil})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"user": userPayload(user)})
}

// sendEmailLink : helper interne, ne fait jamais échouer le caller.
// Issue un token avec le purpose donné et envoie l'email correspondant.
// En dev (mailer nil), on log le lien sur stdout.
func (h *Handlers) sendEmailLink(ctx context.Context, user User, purpose TokenPurpose, path string) {
	token, err := h.Store.IssueToken(ctx, user.ID, purpose)
	if err != nil {
		h.log().Error("issue token", "purpose", purpose, "err", err)
		return
	}
	link := fmt.Sprintf("%s%s?t=%s", strings.TrimRight(h.PublicURL, "/"), path, token)
	if h.Mailer == nil {
		h.log().Warn("mailer désactivé, link en log", "purpose", purpose, "link", link)
		return
	}
	var sendErr error
	switch purpose {
	case PurposeVerifyEmail:
		sendErr = h.Mailer.SendVerifyEmail(user.Email, link)
	case PurposePasswordReset:
		sendErr = h.Mailer.SendPasswordReset(user.Email, link)
	default:
		h.log().Warn("send email: purpose inconnu", "purpose", purpose)
		return
	}
	if sendErr != nil {
		h.log().Error("send email", "purpose", purpose, "err", sendErr)
	}
}

func (h *Handlers) openSession(w http.ResponseWriter, userID int64) {
	sess := Session{UserID: userID, ExpiresAt: time.Now().Add(SessionTTL)}
	h.setSessionCookie(w, Sign(sess, h.SessionSecret), SessionTTL)
}

func (h *Handlers) setSessionCookie(w http.ResponseWriter, value string, ttl time.Duration) {
	c := &http.Cookie{
		Name:     SessionCookieName,
		Value:    value,
		Path:     "/",
		Domain:   h.CookieDomain,
		Expires:  time.Now().Add(ttl),
		HttpOnly: true,
		Secure:   h.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	}
	if ttl <= 0 {
		c.MaxAge = -1
	}
	http.SetCookie(w, c)
}

func (h *Handlers) writeUser(w http.ResponseWriter, user User) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"user": userPayload(user)})
}

func userPayload(u User) map[string]any {
	verified := u.EmailVerifiedAt != nil
	// is_premium : droit effectif (statut actif/essai + période non expirée).
	premium := false
	if u.SubscriptionStatus != nil &&
		(*u.SubscriptionStatus == "active" || *u.SubscriptionStatus == "trialing") {
		premium = u.CurrentPeriodEnd == nil || u.CurrentPeriodEnd.After(time.Now())
	}
	plan := "free"
	if premium {
		plan = "premium"
	}
	payload := map[string]any{
		"id":             u.ID,
		"email":          u.Email,
		"email_verified": verified,
		"plan":           plan,
		"is_premium":     premium,
	}
	if u.CurrentPeriodEnd != nil {
		payload["premium_until"] = u.CurrentPeriodEnd.UTC().Format(time.RFC3339)
	}
	return payload
}

func readToken(r *http.Request) string {
	var body struct {
		Token string `json:"token"`
	}
	dec := json.NewDecoder(io.LimitReader(r.Body, 4*1024))
	_ = dec.Decode(&body)
	return strings.TrimSpace(body.Token)
}
