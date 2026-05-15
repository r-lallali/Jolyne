package admin

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Handlers regroupe les endpoints HTTP du back-office, à monter sous
// /api/admin par main.go.
type Handlers struct {
	Cfg   Config
	Store *Store
}

// HandleLogin (POST /api/admin/login)
//
//	Body : {"email": "...", "password": "..."}
//	Resp : 204 No Content + Set-Cookie ; 404 sinon (jamais 401, voir CLAUDE.md)
func (h *Handlers) HandleLogin(w http.ResponseWriter, r *http.Request) {
	if !IPAllowed(r, h.Cfg.IPAllowlist) {
		http.NotFound(w, r)
		return
	}
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.NotFound(w, r)
		return
	}
	email, err := VerifyCredentials(h.Cfg.Users, body.Email, body.Password)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	exp := time.Now().Add(SessionTTL)
	token := Sign(Session{Email: email, ExpiresAt: exp}, h.Cfg.SessionSecret)

	cookie := &http.Cookie{
		Name:     SessionCookieName,
		Value:    token,
		Path:     "/",
		Expires:  exp,
		Domain:   h.Cfg.CookieDomain,
		HttpOnly: true,
		Secure:   h.Cfg.CookieSecure,
		SameSite: http.SameSiteNoneMode, // cross-subdomain (jolyne ↔ api.jolyne)
	}
	http.SetCookie(w, cookie)
	w.WriteHeader(http.StatusNoContent)
}

// HandleLogout (POST /api/admin/logout) supprime le cookie.
func (h *Handlers) HandleLogout(w http.ResponseWriter, r *http.Request) {
	cookie := &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		Domain:   h.Cfg.CookieDomain,
		HttpOnly: true,
		Secure:   h.Cfg.CookieSecure,
		SameSite: http.SameSiteNoneMode,
	}
	http.SetCookie(w, cookie)
	w.WriteHeader(http.StatusNoContent)
}

// HandleMe (GET /api/admin/me) renvoie l'email connecté — utile au frontend
// pour confirmer l'auth avant de rendre la page.
func (h *Handlers) HandleMe(w http.ResponseWriter, r *http.Request) {
	sess, _ := SessionFromContext(r.Context())
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"email":      sess.Email,
		"expires_at": sess.ExpiresAt.UTC().Format(time.RFC3339),
	})
}

// HandleListReports (GET /api/admin/reports?status=open&limit=50&offset=0)
func (h *Handlers) HandleListReports(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	status := q.Get("status") // "" = tous
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))

	list, err := h.Store.ListReports(r.Context(), status, limit, offset)
	if err != nil {
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"reports": list})
}

// HandleGetReport (GET /api/admin/reports/{id})
func (h *Handlers) HandleGetReport(w http.ResponseWriter, r *http.Request) {
	id, err := parseIDFromPath(r.URL.Path, "/api/admin/reports/")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	d, err := h.Store.GetReport(r.Context(), id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(d)
}

// HandleResolveReport (POST /api/admin/reports/{id}/resolve)
//
//	Body : {"status": "resolved" | "dismissed", "note": "..."}
func (h *Handlers) HandleResolveReport(w http.ResponseWriter, r *http.Request) {
	id, err := parseIDFromPath(r.URL.Path, "/api/admin/reports/")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	// l'URL ressemble à /api/admin/reports/123/resolve — on a déjà l'id
	if !strings.HasSuffix(r.URL.Path, "/resolve") {
		http.NotFound(w, r)
		return
	}

	var body struct {
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	sess, _ := SessionFromContext(r.Context())
	ipH := hashClientIP(r)
	if err := h.Store.ResolveReport(r.Context(), id, body.Status, body.Note, sess.Email, ipH); err != nil {
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// parseIDFromPath extrait l'ID numérique juste après `prefix`.
// /api/admin/reports/123/resolve avec prefix=/api/admin/reports/ → 123.
func parseIDFromPath(path, prefix string) (int64, error) {
	rest := strings.TrimPrefix(path, prefix)
	if slash := strings.Index(rest, "/"); slash >= 0 {
		rest = rest[:slash]
	}
	return strconv.ParseInt(rest, 10, 64)
}

func hashClientIP(r *http.Request) string {
	host := clientIP(r)
	sum := sha256.Sum256([]byte(host))
	return hex.EncodeToString(sum[:8])
}
