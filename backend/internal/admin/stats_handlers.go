package admin

import (
	"encoding/csv"
	"encoding/json"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/ralys/jolyne/backend/internal/bans"
)

// stats_handlers.go : endpoints HTTP /api/admin/stats/* (auth + CORS appliqués
// en amont par mountAdmin). Lecture des agrégations via stats_store.go + ajout
// des données live (online, queues, santé) injectées dans Handlers.

// timeRange lit ?from / ?to (RFC3339). Défaut : 30 derniers jours. `to` est
// borné à maintenant+1j pour inclure la journée courante.
func timeRange(r *http.Request) (from, to time.Time) {
	q := r.URL.Query()
	to = time.Now().Add(24 * time.Hour)
	from = time.Now().AddDate(0, 0, -30)
	if v := q.Get("from"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			from = t
		}
	}
	if v := q.Get("to"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			to = t
		}
	}
	return from, to
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func (h *Handlers) statsErr(w http.ResponseWriter, where string, err error) {
	h.log().Error("admin stats", "where", where, "err", err)
	http.Error(w, "internal", http.StatusInternalServerError)
}

// HandleStatsOverview (GET /api/admin/stats/overview)
func (h *Handlers) HandleStatsOverview(w http.ResponseWriter, r *http.Request) {
	o, err := h.Store.Overview(r.Context())
	if err != nil {
		h.statsErr(w, "overview", err)
		return
	}
	if h.Online != nil {
		o.OnlineNow = h.Online()
	}
	if h.Searching != nil {
		o.Searching = h.Searching()
	}
	if h.Queues != nil {
		o.QueueDepth = h.Queues(r.Context())
	}
	writeJSON(w, o)
}

// HandleStatsFunnel (GET /api/admin/stats/funnel?from&to&format=csv)
func (h *Handlers) HandleStatsFunnel(w http.ResponseWriter, r *http.Request) {
	from, to := timeRange(r)
	stages, err := h.Store.Funnel(r.Context(), from, to)
	if err != nil {
		h.statsErr(w, "funnel", err)
		return
	}
	if r.URL.Query().Get("format") == "csv" {
		rows := make([][]string, len(stages))
		for i, s := range stages {
			rows[i] = []string{s.Key, s.Label, strconv.FormatInt(s.Count, 10)}
		}
		writeCSV(w, "funnel.csv", []string{"key", "label", "count"}, rows)
		return
	}
	writeJSON(w, map[string]any{"stages": stages})
}

// HandleStatsRetention (GET /api/admin/stats/retention?cohort=weekly|daily)
func (h *Handlers) HandleStatsRetention(w http.ResponseWriter, r *http.Request) {
	unit := "week"
	since := time.Now().AddDate(0, 0, -84) // 12 semaines
	if r.URL.Query().Get("cohort") == "daily" {
		unit = "day"
		since = time.Now().AddDate(0, 0, -30)
	}
	rows, err := h.Store.Retention(r.Context(), unit, since)
	if err != nil {
		h.statsErr(w, "retention", err)
		return
	}
	writeJSON(w, map[string]any{"unit": unit, "cohorts": rows})
}

// HandleStatsTimeSeries (GET /api/admin/stats/timeseries?metric&interval&from&to&format=csv)
func (h *Handlers) HandleStatsTimeSeries(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	metric := q.Get("metric")
	interval := q.Get("interval")
	if interval == "" {
		interval = "day"
	}
	from, to := timeRange(r)
	points, err := h.Store.TimeSeries(r.Context(), metric, interval, from, to)
	if err != nil {
		// Métrique inconnue = erreur client, pas serveur.
		http.Error(w, "bad metric", http.StatusBadRequest)
		return
	}
	if q.Get("format") == "csv" {
		rows := make([][]string, len(points))
		for i, p := range points {
			rows[i] = []string{p.Bucket.Format(time.RFC3339), strconv.FormatInt(p.Value, 10)}
		}
		writeCSV(w, metric+".csv", []string{"bucket", "value"}, rows)
		return
	}
	writeJSON(w, map[string]any{"metric": metric, "interval": interval, "points": points})
}

// HandleStatsEngagement (GET /api/admin/stats/engagement?from&to)
func (h *Handlers) HandleStatsEngagement(w http.ResponseWriter, r *http.Request) {
	from, to := timeRange(r)
	e, err := h.Store.Engagement(r.Context(), from, to)
	if err != nil {
		h.statsErr(w, "engagement", err)
		return
	}
	writeJSON(w, e)
}

// HandleStatsRevenue (GET /api/admin/stats/revenue?from&to)
func (h *Handlers) HandleStatsRevenue(w http.ResponseWriter, r *http.Request) {
	from, to := timeRange(r)
	rev, err := h.Store.Revenue(r.Context(), from, to, h.Cfg.PremiumMonthlyCents)
	if err != nil {
		h.statsErr(w, "revenue", err)
		return
	}
	writeJSON(w, rev)
}

// ServerSnapshot : état runtime + santé + live, pour la page /admin/server.
type ServerSnapshot struct {
	Goroutines  int               `json:"goroutines"`
	HeapAllocMB float64           `json:"heap_alloc_mb"`
	NumGC       uint32            `json:"num_gc"`
	UptimeSec   int64             `json:"uptime_sec"`
	OnlineNow   int               `json:"online_now"`
	Searching   int               `json:"searching"`
	QueueDepth  []QueueDepth      `json:"queue_depth"`
	Health      map[string]string `json:"health"`
	DBPool      map[string]int64  `json:"db_pool"`
}

// HandleStatsServer (GET /api/admin/stats/server)
func (h *Handlers) HandleStatsServer(w http.ResponseWriter, r *http.Request) {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	snap := ServerSnapshot{
		Goroutines:  runtime.NumGoroutine(),
		HeapAllocMB: float64(mem.HeapAlloc) / (1024 * 1024),
		NumGC:       mem.NumGC,
		QueueDepth:  []QueueDepth{},
		Health:      map[string]string{},
		DBPool:      map[string]int64{},
	}
	if !h.StartedAt.IsZero() {
		snap.UptimeSec = int64(time.Since(h.StartedAt).Seconds())
	}
	if h.Online != nil {
		snap.OnlineNow = h.Online()
	}
	if h.Searching != nil {
		snap.Searching = h.Searching()
	}
	if h.Queues != nil {
		snap.QueueDepth = h.Queues(r.Context())
	}
	if h.Health != nil {
		snap.Health = h.Health(r.Context())
	}
	if h.PoolStats != nil {
		snap.DBPool = h.PoolStats()
	}
	writeJSON(w, snap)
}

// ---------------------------------------------------------------------------
// Utilisateurs — recherche, fiche, actions.
// ---------------------------------------------------------------------------

// HandleUsersList (GET /api/admin/stats/users?q&limit&offset&format=csv)
func (h *Handlers) HandleUsersList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))
	users, err := h.Store.SearchUsers(r.Context(), strings.TrimSpace(q.Get("q")), limit, offset)
	if err != nil {
		h.statsErr(w, "users", err)
		return
	}
	if q.Get("format") == "csv" {
		rows := make([][]string, len(users))
		for i, u := range users {
			last := ""
			if u.LastSeenAt != nil {
				last = u.LastSeenAt.Format(time.RFC3339)
			}
			rows[i] = []string{strconv.FormatInt(u.ID, 10), u.Email, u.Plan,
				strconv.FormatBool(u.Verified), u.CreatedAt.Format(time.RFC3339), last}
		}
		writeCSV(w, "users.csv", []string{"id", "email", "plan", "verified", "created_at", "last_seen_at"}, rows)
		return
	}
	writeJSON(w, map[string]any{"users": users})
}

// HandleUserDetail (GET /api/admin/stats/users/{id})
func (h *Handlers) HandleUserDetail(w http.ResponseWriter, r *http.Request, id int64) {
	d, err := h.Store.UserDetail(r.Context(), id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	writeJSON(w, d)
}

// HandleUserPremium (POST /api/admin/stats/users/{id}/premium) — body {grant: bool}
func (h *Handlers) HandleUserPremium(w http.ResponseWriter, r *http.Request, id int64) {
	var body struct {
		Grant bool `json:"grant"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	sess, _ := SessionFromContext(r.Context())
	if err := h.Store.SetPlan(r.Context(), id, body.Grant, sess.Email, hashClientIP(r)); err != nil {
		h.statsErr(w, "set plan", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleUserBan (POST /api/admin/stats/users/{id}/ban) — body {duration, reason}
// Bannit sur l'axe `user`. L'enregistrement est immédiat et audité.
func (h *Handlers) HandleUserBan(w http.ResponseWriter, r *http.Request, id int64) {
	if h.Bans == nil {
		http.Error(w, "bans désactivés", http.StatusServiceUnavailable)
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
	sess, _ := SessionFromContext(r.Context())
	if _, err := h.Bans.IssueBan(r.Context(), bans.Issue{
		UserID:   strconv.FormatInt(id, 10),
		Reason:   body.Reason,
		BannedBy: sess.Email,
		Duration: dur,
	}, hashClientIP(r)); err != nil {
		h.statsErr(w, "ban user", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleUserExport (GET /api/admin/stats/users/{id}/data) — RGPD droit d'accès.
func (h *Handlers) HandleUserExport(w http.ResponseWriter, r *http.Request, id int64) {
	data, err := h.Store.ExportUser(r.Context(), id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Disposition", "attachment; filename=\"user-"+strconv.FormatInt(id, 10)+".json\"")
	writeJSON(w, data)
}

// HandleUserDelete (DELETE /api/admin/stats/users/{id}) — RGPD droit à l'oubli.
func (h *Handlers) HandleUserDelete(w http.ResponseWriter, r *http.Request, id int64) {
	sess, _ := SessionFromContext(r.Context())
	if err := h.Store.DeleteUser(r.Context(), id, sess.Email, hashClientIP(r)); err != nil {
		h.statsErr(w, "delete user", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleUsersSubtree dispatch /api/admin/stats/users/{id}[/premium|/ban|/data]
// par méthode + suffixe. Centralisé ici pour réutiliser parseIDFromPath.
func (h *Handlers) HandleUsersSubtree(w http.ResponseWriter, r *http.Request) {
	id, err := parseIDFromPath(r.URL.Path, "/api/admin/stats/users/")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	path := r.URL.Path
	switch {
	case r.Method == http.MethodGet && strings.HasSuffix(path, "/data"):
		h.HandleUserExport(w, r, id)
	case r.Method == http.MethodPost && strings.HasSuffix(path, "/premium"):
		h.HandleUserPremium(w, r, id)
	case r.Method == http.MethodPost && strings.HasSuffix(path, "/ban"):
		h.HandleUserBan(w, r, id)
	case r.Method == http.MethodGet:
		h.HandleUserDetail(w, r, id)
	case r.Method == http.MethodDelete:
		h.HandleUserDelete(w, r, id)
	default:
		http.NotFound(w, r)
	}
}

// HandleAudit (GET /api/admin/stats/audit?limit&offset)
func (h *Handlers) HandleAudit(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	entries, err := h.Store.AuditLog(r.Context(), limit, offset)
	if err != nil {
		h.statsErr(w, "audit", err)
		return
	}
	writeJSON(w, map[string]any{"entries": entries})
}

// writeCSV émet une réponse CSV téléchargeable.
func writeCSV(w http.ResponseWriter, filename string, header []string, rows [][]string) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
	cw := csv.NewWriter(w)
	_ = cw.Write(header)
	for _, row := range rows {
		_ = cw.Write(row)
	}
	cw.Flush()
}
