package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/admin"
	"github.com/ralys/jolyne/backend/internal/ws"
)

// services regroupe les dépendances utilisées par les handlers HTTP.
type services struct {
	rdb       *redis.Client
	pg        *pgxpool.Pool // nil si POSTGRES_DSN non renseigné
	wsHandler *ws.Handler
	admin     *admin.Handlers // nil si back-office désactivé
}

func routes(s services) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", healthz(s))
	mux.Handle("GET /ws/match", s.wsHandler)

	if s.admin != nil {
		mountAdmin(mux, s.admin)
	}
	return mux
}

// mountAdmin enregistre les endpoints /api/admin/* avec le middleware
// d'auth (sauf /login qui doit être joignable sans cookie).
func mountAdmin(mux *http.ServeMux, h *admin.Handlers) {
	cors := admin.CORSMiddleware(h.Cfg)
	auth := admin.AuthMiddleware(h.Cfg)

	// Public (juste CORS) — l'IP allowlist est checkée dedans
	mux.Handle("POST /api/admin/login", cors(http.HandlerFunc(h.HandleLogin)))
	// Logout n'a pas besoin d'auth (le client peut juste virer son cookie)
	mux.Handle("POST /api/admin/logout", cors(http.HandlerFunc(h.HandleLogout)))
	// Preflight OPTIONS — Go ServeMux ne route pas sur OPTIONS pour ces
	// patterns automatiquement, on délègue via une fonction catch-all.
	mux.Handle("OPTIONS /api/admin/", cors(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})))

	// Protégé
	mux.Handle("GET /api/admin/me", cors(auth(http.HandlerFunc(h.HandleMe))))
	mux.Handle("GET /api/admin/reports", cors(auth(http.HandlerFunc(h.HandleListReports))))
	// Route paramétrée : Go 1.22 mux ne supporte pas {id} pour POST + suffix
	// chained. On utilise un router manuel pour /api/admin/reports/...
	mux.Handle("/api/admin/reports/", cors(auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && !strings.HasSuffix(r.URL.Path, "/resolve"):
			h.HandleGetReport(w, r)
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/resolve"):
			h.HandleResolveReport(w, r)
		default:
			http.NotFound(w, r)
		}
	}))))
}

// healthz pingue Redis et Postgres (si configuré). 200 si tout va, 503 sinon.
func healthz(s services) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		status := map[string]string{"status": "ok"}
		code := http.StatusOK

		ctx, cancel := context.WithTimeout(r.Context(), time.Second)
		defer cancel()

		if err := s.rdb.Ping(ctx).Err(); err != nil {
			status["status"] = "degraded"
			status["redis"] = err.Error()
			code = http.StatusServiceUnavailable
		}

		if s.pg != nil {
			if err := s.pg.Ping(ctx); err != nil {
				status["status"] = "degraded"
				status["postgres"] = err.Error()
				code = http.StatusServiceUnavailable
			}
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(status)
	}
}
