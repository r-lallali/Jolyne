package ws

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/analytics"
	"github.com/ralys/jolyne/backend/internal/bans"
	"github.com/ralys/jolyne/backend/internal/blocking"
	"github.com/ralys/jolyne/backend/internal/friends"
	"github.com/ralys/jolyne/backend/internal/matcher"
	"github.com/ralys/jolyne/backend/internal/moderation"
	"github.com/ralys/jolyne/backend/internal/netx"
	"github.com/ralys/jolyne/backend/internal/profile"
	"github.com/ralys/jolyne/backend/internal/quota"
	"github.com/ralys/jolyne/backend/internal/reports"
	"github.com/ralys/jolyne/backend/internal/session"
)

// Constantes communes aux boucles `runSession` / `runChat`. Regroupées
// ici parce qu'elles définissent la *politique* du gateway WS (timings,
// limites de payload, fenêtres anti-abus). Voir CLAUDE.md §WebSocket.
const (
	queueTimeout    = 30 * time.Second
	nextMinInterval = time.Second
	// Nombre max de messages capturés dans la fenêtre glissante pour les
	// signalements. 20 est suffisant pour donner le contexte sans gonfler
	// la table reports.
	captureWindow   = 20
	reasonMaxLength = 500

	// IDs éphémères de messages : générés côté client pour permettre au peer
	// d'ancrer une correction. On les valide en longueur uniquement (pas un
	// secret, juste un opaque). 1-64 chars.
	msgIDMaxLength = 64

	// Throttle anti-abus pour les corrections (1 par 3 s par session).
	correctMinInterval = 3 * time.Second

	// Limites de taille des champs d'une correction.
	correctionTextMax = 2000
	correctionNoteMax = 500

	// Délai avant d'émettre le friend_prompt aux deux peers, puis fenêtre
	// pendant laquelle attendre la double acceptation. Si l'un n'accepte
	// pas dans la fenêtre, friend_skipped est envoyé à l'autre.
	friendPromptDelay  = 5 * time.Minute
	friendAcceptWindow = 60 * time.Second

	// Durée d'une phase de session tandem 50/50 (2 phases : langue A puis
	// langue B). 10 min chacune = le format classique des tandems.
	tandemPhaseDuration = 10 * time.Minute
)

type Deps struct {
	RDB      *redis.Client
	Matcher  *matcher.Matcher
	Hub      *Hub
	Quota    *quota.Engine
	Block    *moderation.Blocklist
	Reports  *reports.Service  // nil si Postgres / clé de chiffrement absents
	Bans     *bans.Service     // nil si Postgres absent
	Blocking *blocking.Service // block-list personnelle (auto-ajout sur report)
	// Auth user (optionnelle, pour résoudre le cookie au handshake et
	// remplir Session.UserID si valide). nil = WS toujours anonyme.
	UserAuth *UserAuth
	// ResolvePlan (optionnel) : résout le plan réel d'un user authentifié
	// (Premium si abonnement actif). nil → tout le monde reste Free.
	ResolvePlan func(ctx context.Context, userID int64) session.Plan
	// ResolveCEFR (optionnel) : niveau CECRL estimé d'un user (1.0..6.0,
	// 0 = inconnu). Sert à la préférence de niveau du matcher, au badge
	// peer_profile et au calibrage du prof IA.
	ResolveCEFR func(ctx context.Context, userID int64) float64
	// Friends (optionnel). Si présent, le prompt ami 10-min est éligible
	// quand les deux peers sont authentifiés.
	Friends *friends.Store
	// Profiles (optionnel). Si présent et que le peer est authentifié,
	// on envoie un ServerPeerProfile au match (avatar + 3 prompts).
	Profiles *profile.Store
	// Bot prof IA (optionnel). Si présent et qu'aucun peer humain ne se
	// connecte au bout de TriggerDelay, un bot prend la main pour offrir
	// une expérience de conversation continue.
	Bot *BotManager
	// Toxicity (optionnel). Si présent, chaque message du chat anonyme est
	// classé en arrière-plan par Claude ; les récidivistes sont avertis puis
	// suspendus. nil = seule la blocklist statique s'applique.
	Toxicity *ToxicityGuard
	// Icebreakers (optionnel). Si présent, un match humain-humain reçoit des
	// amorces de conversation fraîches (frame `icebreakers`, asynchrone).
	Icebreakers *IcebreakerService
	// Analyzer (optionnel). Si présent, la fin d'une conversation (compte
	// authentifié) déclenche l'analyse IA : vocabulaire → carnet, fautes →
	// items de révision (leçon du jour), niveau CECRL → profil.
	Analyzer *SessionAnalyzer
	// Tracker analytics (optionnel). Émet les events de funnel (match_found,
	// bot_fallback, message_sent, conversation_ended…). Nil-safe.
	Tracker *analytics.Tracker
	// TrustedProxies : nombre de reverse-proxies frontaux (Caddy = 1). Sert à
	// résoudre l'IP cliente réelle pour le hash IP (bans/report) — sans ça,
	// r.RemoteAddr = IP du conteneur Caddy, identique pour toutes les sessions.
	TrustedProxies int
	Log            *slog.Logger
}

// UserAuth abstrait les bouts du package users dont le WS a besoin
// (verify cookie + cookie name). Évite l'import circulaire.
type UserAuth struct {
	CookieName    string
	SessionSecret []byte
	// Verify décode le token et renvoie l'userID + la version de session signée.
	Verify func(token string, secret []byte) (userID int64, version int64, err error)
	// ValidateVersion (optionnel) : confronte la version signée à la version
	// courante en DB (bumpée au reset de mot de passe). nil = pas de check
	// (dev / compat). false → session révoquée, le WS reste anonyme.
	ValidateVersion func(ctx context.Context, userID, version int64) bool
}

// Resolve lit le cookie de session et renvoie l'userID si la signature est
// valide ET la version non révoquée. 0 sinon. Best-effort : un échec ne bloque
// jamais l'upgrade (le WS anonyme reste possible côté match public).
func (a *UserAuth) Resolve(ctx context.Context, r *http.Request) int64 {
	if a == nil {
		return 0
	}
	c, err := r.Cookie(a.CookieName)
	if err != nil {
		return 0
	}
	uid, version, err := a.Verify(c.Value, a.SessionSecret)
	if err != nil {
		return 0
	}
	if a.ValidateVersion != nil && !a.ValidateVersion(ctx, uid, version) {
		return 0
	}
	return uid
}

// Handler sert la route /ws/match. La validation des paramètres se fait
// AVANT l'upgrade WebSocket : un client invalide se voit refuser en 400
// JSON et n'établit jamais de socket — meilleure protection contre les
// connexions zombie côté Redis.
type Handler struct {
	d      Deps
	online atomic.Int64 // connexions WS actives (jauge Prometheus)
}

func NewHandler(d Deps) *Handler { return &Handler{d: d} }

// Online renvoie le nombre de connexions WebSocket actuellement établies.
func (h *Handler) Online() int64 { return h.online.Load() }

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	params, err := parseParams(r)
	if err != nil {
		respondJSONError(w, http.StatusBadRequest, "invalid_param", err.Error())
		return
	}
	if err := moderation.ValidatePseudo(params.nick, h.d.Block); err != nil {
		respondJSONError(w, http.StatusBadRequest, "invalid_pseudo", err.Error())
		return
	}
	if err := matcher.ValidatePair(params.speaks, params.wants); err != nil {
		respondJSONError(w, http.StatusBadRequest, "invalid_param", err.Error())
		return
	}
	// Scénario de jeu de rôle : uniquement en mode prof IA, et connu du
	// catalogue. Le gating premium se fait après résolution du plan (plus bas).
	if params.scenario != "" {
		if _, ok := scenarioByID(params.scenario); !ok || !params.botMode {
			respondJSONError(w, http.StatusBadRequest, "invalid_param", "scénario inconnu")
			return
		}
	}

	// Résout le cookie user AVANT l'upgrade — si présent et valide, la
	// session WS porte UserID > 0 et le flow ami devient éligible. Sinon
	// la WS reste anonyme.
	userID := h.resolveUserID(r)

	conn, err := Upgrade(w, r)
	if err != nil {
		h.d.Log.Warn("ws upgrade failed", "err", err)
		return
	}

	sess := session.New(
		params.nick,
		string(params.speaks),
		string(params.wants),
		params.fingerprint,
		h.hashIP(r),
		session.PlanFree,
	)
	sess.UserID = userID
	// Résout le plan réel : Premium si abonnement actif. Anonyme = Free.
	if userID > 0 && h.d.ResolvePlan != nil {
		sess.Plan = h.d.ResolvePlan(r.Context(), userID)
	}
	// Niveau CECRL estimé (0 si anonyme / jamais estimé) : préférence de
	// niveau du matcher + calibrage du prof IA.
	if userID > 0 && h.d.ResolveCEFR != nil {
		sess.CEFR = h.d.ResolveCEFR(r.Context(), userID)
	}

	// Gating premium des scénarios : les scénarios d'appel sont gratuits, le
	// reste requiert l'abonnement. Frame d'erreur terminale → paywall côté
	// front (même pattern que les quotas).
	if params.scenario != "" {
		if sc, _ := scenarioByID(params.scenario); !sc.Free && sess.Plan != session.PlanPremium {
			conn.WriteAndClose(ServerFrame{Type: ServerError, Code: ErrCodeScenarioPremium})
			return
		}
		sess.Scenario = params.scenario
	}

	// Check ban actif AVANT registration / matching. Sur match, le client
	// reçoit une frame error code=banned avec la durée restante puis la WS
	// se ferme proprement.
	if h.d.Bans != nil {
		if b, err := h.d.Bans.CheckActive(r.Context(), sess.IPHash, sess.Fingerprint); err != nil {
			h.d.Log.Warn("ban check failed", "err", err)
		} else if b != nil {
			conn.WriteAndClose(ServerFrame{
				Type:    ServerError,
				Code:    ErrCodeBanned,
				Message: banMessage(b),
			})
			return
		}
	}

	// À partir d'ici la connexion est établie et acceptée : on la compte en
	// ligne et on émet l'event de présence (decrément + ws_disconnected via
	// defer à la fermeture).
	h.online.Add(1)
	defer h.online.Add(-1)
	h.d.Tracker.Emit(analytics.Event{
		Name:      analytics.EventWSConnected,
		UserID:    sess.UserID,
		SessionID: sess.ID,
		IPHash:    sess.IPHash,
		LangFrom:  string(params.speaks),
		LangTo:    string(params.wants),
	})
	defer h.d.Tracker.Emit(analytics.Event{
		Name:      analytics.EventWSDisconnected,
		UserID:    sess.UserID,
		SessionID: sess.ID,
	})

	wakeup := h.d.Hub.Register(sess)
	defer h.d.Hub.Unregister(sess.ID)

	go conn.Run(r.Context())
	h.runSession(r.Context(), conn, sess, wakeup, params.botMode)
}

// banMessage formate une raison utilisateur-visible (sans détails internes).
func banMessage(b *bans.Ban) string {
	if b.ExpiresAt == nil {
		if b.Reason != "" {
			return "Tu as été banni définitivement. Raison : " + b.Reason
		}
		return "Tu as été banni définitivement."
	}
	until := b.ExpiresAt.Format("2006-01-02 15:04 MST")
	if b.Reason != "" {
		return "Tu es suspendu jusqu'au " + until + ". Raison : " + b.Reason
	}
	return "Tu es suspendu jusqu'au " + until + "."
}

// resolveUserID lit le cookie de session user du request et renvoie le
// UserID si valide. 0 si pas de cookie / auth désactivée / cookie invalide /
// session révoquée. Best-effort : un échec ne bloque pas l'upgrade — la WS
// reste anonyme.
func (h *Handler) resolveUserID(r *http.Request) int64 {
	return h.d.UserAuth.Resolve(r.Context(), r)
}

// hashIP hashe l'IP cliente avec SHA-256. Les logs ou la télémétrie ne
// doivent jamais voir l'IP brute (CLAUDE.md règle d'or #6). L'IP réelle est
// résolue via netx en tenant compte des proxies frontaux — sinon toutes les
// sessions partageraient le hash de l'IP de Caddy et les bans/report par IP
// seraient inopérants (ou globaux).
func (h *Handler) hashIP(r *http.Request) string {
	sum := sha256.Sum256([]byte(netx.ClientIP(r, h.d.TrustedProxies)))
	return hex.EncodeToString(sum[:8])
}

func respondJSONError(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"code": code, "message": msg})
}

func mapModerationErr(err error) string {
	switch {
	case errors.Is(err, moderation.ErrMessageBlocked):
		return ErrCodeMessageBlocked
	case errors.Is(err, moderation.ErrMessageTooLong):
		return ErrCodeMessageTooLong
	default:
		return ErrCodeInvalidParam
	}
}
