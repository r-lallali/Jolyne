package users

import (
	"context"
	"net/http"
	"time"
)

type ctxKey int

const ctxKeyUser ctxKey = iota

// RequireAuth : middleware HTTP qui exige une session user valide. 401
// JSON si pas de cookie / signature invalide. Pose le user dans le ctx.
func (h *Handlers) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(SessionCookieName)
		if err != nil {
			http.Error(w, "auth required", http.StatusUnauthorized)
			return
		}
		sess, err := VerifySession(cookie.Value, h.SessionSecret)
		if err != nil {
			http.Error(w, "auth required", http.StatusUnauthorized)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		user, err := h.Store.GetByID(ctx, sess.UserID)
		if err != nil {
			http.Error(w, "auth required", http.StatusUnauthorized)
			return
		}
		// Révocation : un cookie signé avant un reset de mot de passe porte une
		// version < à celle en base → session invalide.
		if sess.Version != user.SessionVersion {
			http.Error(w, "auth required", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKeyUser, user)))
	})
}

// CurrentUser : récupère le user posé par RequireAuth.
func CurrentUser(ctx context.Context) (User, bool) {
	u, ok := ctx.Value(ctxKeyUser).(User)
	return u, ok
}
