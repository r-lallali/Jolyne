package admin

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ralys/jolyne/backend/internal/bans"
)

// Handlers regroupe les endpoints HTTP du back-office, à monter sous
// /api/admin par main.go.
type Handlers struct {
	Cfg   Config
	Store *Store
	Bans  *bans.Service // nil si Postgres absent
	Log   *slog.Logger  // peut être nil — handlers tolèrent

	// Données « live » non persistées, injectées au câblage (cf. main.go).
	// Toutes nil-safe : un handler overview tolère leur absence.
	Online    func() int                                  // utilisateurs connectés (Hub)
	Searching func() int                                  // en attente d'un peer (Hub)
	Queues    func(ctx context.Context) []QueueDepth      // profondeur des files Redis
	PoolStats func() map[string]int64                     // stats du pool Postgres
	Health    func(ctx context.Context) map[string]string // ping Redis/Postgres
	StartedAt time.Time                                   // pour calculer l'uptime
}

func (h *Handlers) log() *slog.Logger {
	if h.Log != nil {
		return h.Log
	}
	return slog.Default()
}

// HandleLogin (POST /api/admin/login)
//
//	Body : {"email": "...", "password": "..."}
//	Resp : 204 No Content + Set-Cookie ; 404 sinon (jamais 401, voir CLAUDE.md)
func (h *Handlers) HandleLogin(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if !IPAllowed(r, h.Cfg.IPAllowlist) {
		h.log().Warn("admin login refusé",
			"reason", "ip_not_allowed",
			"client_ip", ip,
			"allowlist_size", len(h.Cfg.IPAllowlist))
		http.NotFound(w, r)
		return
	}
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.log().Warn("admin login refusé",
			"reason", "bad_json",
			"client_ip", ip,
			"err", err.Error())
		http.NotFound(w, r)
		return
	}
	email, err := VerifyCredentials(h.Cfg.Users, body.Email, body.Password)
	if err != nil {
		reason := "bad_credentials"
		switch {
		case errors.Is(err, ErrEmailNotFound):
			reason = "email_not_found"
		case errors.Is(err, ErrPasswordMismatch):
			reason = "password_mismatch"
		}
		// Pas d'email en clair dans les logs (règle d'or #6) — empreinte tronquée.
		h.log().Warn("admin login refusé",
			"reason", reason,
			"client_ip", ip,
			"email_hash", hashEmail(body.Email),
			"users_loaded", len(h.Cfg.Users))
		http.NotFound(w, r)
		return
	}
	h.log().Info("admin login ok", "email_hash", hashEmail(email), "client_ip", ip)

	exp := time.Now().Add(SessionTTL)
	token := Sign(Session{Email: email, ExpiresAt: exp}, h.Cfg.SessionSecret)

	cookie := &http.Cookie{ //nolint:gosec // G124 : HttpOnly+SameSite posés, Secure conditionné dev/prod
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
func (h *Handlers) HandleLogout(w http.ResponseWriter, _ *http.Request) {
	cookie := &http.Cookie{ //nolint:gosec // G124 : HttpOnly+SameSite posés, Secure conditionné dev/prod
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
//	Body : {"status": "resolved", "note": "..."}
func (h *Handlers) HandleResolveReport(w http.ResponseWriter, r *http.Request) {
	id, err := parseIDFromPath(r.URL.Path, "/api/admin/reports/")
	if err != nil {
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
		if errors.Is(err, ErrReportNotOpen) {
			// Le signalement est déjà clos — l'utilisateur a probablement
			// rafraîchi sur une vieille page. On répond 409 plutôt qu'erreur.
			http.Error(w, "conflict", http.StatusConflict)
			return
		}
		h.log().Error("resolve report", "id", id, "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleReopenReport (POST /api/admin/reports/{id}/reopen)
//
//	Body : {"note": "..."}  (optionnel)
func (h *Handlers) HandleReopenReport(w http.ResponseWriter, r *http.Request) {
	id, err := parseIDFromPath(r.URL.Path, "/api/admin/reports/")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	var body struct {
		Note string `json:"note"`
	}
	// Body optionnel — on ignore l'erreur de décodage si vide.
	_ = json.NewDecoder(r.Body).Decode(&body)

	sess, _ := SessionFromContext(r.Context())
	ipH := hashClientIP(r)
	if err := h.Store.ReopenReport(r.Context(), id, body.Note, sess.Email, ipH); err != nil {
		if errors.Is(err, ErrReportNotClosed) {
			http.Error(w, "conflict", http.StatusConflict)
			return
		}
		h.log().Error("reopen report", "id", id, "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleBanFromReport (POST /api/admin/reports/{id}/ban)
//
//	Body : {"duration": "24h"|"7d"|"30d"|"permanent", "reason": "..."}
//
// Combine ban (ip + fingerprint du reporté) + résolution du signalement.
// Si le ban échoue, le report reste open ; si le report ne peut pas être
// résolu après ban, on log mais on n'annule pas le ban (le ban prime).
func (h *Handlers) HandleBanFromReport(w http.ResponseWriter, r *http.Request) {
	if h.Bans == nil {
		http.Error(w, "bans désactivés", http.StatusServiceUnavailable)
		return
	}
	id, err := parseIDFromPath(r.URL.Path, "/api/admin/reports/")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	var body struct {
		Duration string `json:"duration"`
		Reason   string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	dur, err := parseBanDuration(body.Duration)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	fingerprint, ipHash, err := h.Store.BanTargets(r.Context(), id)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	sess, _ := SessionFromContext(r.Context())
	ipAudit := hashClientIP(r)
	relatedID := id
	if _, err := h.Bans.IssueBan(r.Context(), bans.Issue{
		IPHash:          ipHash,
		Fingerprint:     fingerprint,
		Reason:          body.Reason,
		BannedBy:        sess.Email,
		Duration:        dur,
		RelatedReportID: &relatedID,
	}, ipAudit); err != nil {
		h.log().Error("ban issue from report", "report", id, "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	// Résolution best-effort. Si le report n'est plus open (déjà clos),
	// on ignore — le ban reste effectif.
	note := body.Reason
	if note == "" {
		note = "Ban prononcé (" + body.Duration + ")"
	} else {
		note = "Ban prononcé (" + body.Duration + ") — " + note
	}
	if err := h.Store.ResolveReport(r.Context(), id, "resolved", note, sess.Email, ipAudit); err != nil && !errors.Is(err, ErrReportNotOpen) {
		h.log().Warn("resolve after ban failed", "report", id, "err", err)
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleListBans (GET /api/admin/bans)
func (h *Handlers) HandleListBans(w http.ResponseWriter, r *http.Request) {
	if h.Bans == nil {
		http.Error(w, "bans désactivés", http.StatusServiceUnavailable)
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	list, err := h.Bans.ListActive(r.Context(), limit)
	if err != nil {
		h.log().Error("list bans", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"bans": list})
}

// HandleLiftBan (POST /api/admin/bans/{id}/lift)
func (h *Handlers) HandleLiftBan(w http.ResponseWriter, r *http.Request) {
	if h.Bans == nil {
		http.Error(w, "bans désactivés", http.StatusServiceUnavailable)
		return
	}
	id, err := parseIDFromPath(r.URL.Path, "/api/admin/bans/")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	sess, _ := SessionFromContext(r.Context())
	ipAudit := hashClientIP(r)
	if err := h.Bans.Lift(r.Context(), id, sess.Email, ipAudit); err != nil {
		h.log().Warn("lift ban", "id", id, "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// parseBanDuration accepte les options du UI : 24h / 7d / 30d / permanent.
// 0 = permanent.
func parseBanDuration(s string) (time.Duration, error) {
	switch strings.TrimSpace(s) {
	case "permanent", "":
		return 0, nil
	case "24h", "1d":
		return 24 * time.Hour, nil
	case "7d":
		return 7 * 24 * time.Hour, nil
	case "30d":
		return 30 * 24 * time.Hour, nil
	default:
		return 0, errors.New("duration: valeur invalide (24h|7d|30d|permanent)")
	}
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

// hashEmail : empreinte SHA-256 tronquée (16 chars hex) d'un email, pour
// corréler un admin dans les logs sans exposer l'adresse (règle d'or #6).
// L'email est normalisé (minuscule, trim) pour un hash stable.
func hashEmail(email string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(email))))
	return hex.EncodeToString(sum[:8])
}
