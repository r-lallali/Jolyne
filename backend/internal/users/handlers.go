package users

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/ralys/jolyne/backend/internal/mailer"
)

// Handlers regroupe les endpoints HTTP auth utilisateur (côté public).
type Handlers struct {
	Store         *Store
	Mailer        *mailer.Mailer
	SessionSecret []byte
	CookieDomain  string
	CookieSecure  bool
	PublicURL     string // ex: https://jolyne.ralys.ovh — utilisé pour fabriquer le lien magic
	Log           *slog.Logger
}

func (h *Handlers) log() *slog.Logger {
	if h.Log != nil {
		return h.Log
	}
	return slog.Default()
}

type ctxKey int

const ctxKeyUser ctxKey = iota

// HandleRequest : POST /api/auth/request {email} → 204 (envoie le mail).
// On répond TOUJOURS 204 même si l'email est invalide ou si l'envoi échoue,
// pour ne pas révéler quels emails sont enregistrés. Échec d'envoi loggé.
func (h *Handlers) HandleRequest(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024)).Decode(&body); err != nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	body.Email = strings.ToLower(strings.TrimSpace(body.Email))
	addr, err := mail.ParseAddress(body.Email)
	if err != nil || addr.Address == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()

	user, err := h.Store.UpsertByEmail(ctx, addr.Address)
	if err != nil {
		h.log().Error("auth request upsert", "err", err)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	token, err := h.Store.IssueToken(ctx, user.ID)
	if err != nil {
		h.log().Error("auth request issue", "err", err)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	link := fmt.Sprintf("%s/auth/verify?t=%s", strings.TrimRight(h.PublicURL, "/"), token)

	if h.Mailer == nil {
		// Dev : pas de SMTP configuré → log le lien pour copier-coller.
		h.log().Warn("auth request: mailer désactivé, link en log", "link", link)
	} else if err := h.Mailer.SendMagicLink(addr.Address, link); err != nil {
		h.log().Error("auth request send", "err", err)
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleVerify : POST /api/auth/verify {token} → 200 {user:{id,email}} + Set-Cookie.
func (h *Handlers) HandleVerify(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024)).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(body.Token) == "" {
		http.Error(w, "token required", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	userID, err := h.Store.ConsumeToken(ctx, body.Token)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}
	user, err := h.Store.GetByID(ctx, userID)
	if err != nil {
		h.log().Error("auth verify get user", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	_ = h.Store.TouchLastSeen(ctx, userID)

	sess := Session{UserID: userID, ExpiresAt: time.Now().Add(SessionTTL)}
	h.setSessionCookie(w, Sign(sess, h.SessionSecret), SessionTTL)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"user": map[string]any{"id": user.ID, "email": user.Email},
	})
}

// HandleLogout : POST /api/auth/logout → 204 + cookie expiré.
func (h *Handlers) HandleLogout(w http.ResponseWriter, r *http.Request) {
	h.setSessionCookie(w, "", -time.Hour)
	w.WriteHeader(http.StatusNoContent)
}

// HandleMe : GET /api/auth/me → 200 {user} si session valide, 401 sinon.
func (h *Handlers) HandleMe(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(SessionCookieName)
	if err != nil {
		http.Error(w, "no session", http.StatusUnauthorized)
		return
	}
	sess, err := VerifySession(cookie.Value, h.SessionSecret)
	if err != nil {
		http.Error(w, "invalid session", http.StatusUnauthorized)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	user, err := h.Store.GetByID(ctx, sess.UserID)
	if err != nil {
		http.Error(w, "user not found", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"user": map[string]any{"id": user.ID, "email": user.Email},
	})
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
