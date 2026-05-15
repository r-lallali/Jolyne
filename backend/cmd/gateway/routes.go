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

// mountAdmin enregistre les endpoints /api/admin/* SANS contrainte de
// méthode — le CORS middleware intercepte OPTIONS, chaque handler vérifie
// la méthode requise et renvoie 405 si inadaptée. Plus déterministe que
// la combo `POST /path` + `OPTIONS /sub/`.
func mountAdmin(mux *http.ServeMux, h *admin.Handlers) {
	cors := admin.CORSMiddleware(h.Cfg)
	auth := admin.AuthMiddleware(h.Cfg)

	mux.Handle("/api/admin/login", cors(methodOnly("POST", http.HandlerFunc(h.HandleLogin))))
	mux.Handle("/api/admin/logout", cors(methodOnly("POST", http.HandlerFunc(h.HandleLogout))))
	mux.Handle("/api/admin/me", cors(auth(methodOnly("GET", http.HandlerFunc(h.HandleMe)))))
	mux.Handle("/api/admin/reports", cors(auth(methodOnly("GET", http.HandlerFunc(h.HandleListReports)))))

	// Subtree /api/admin/reports/{id}[/resolve] — dispatch interne par
	// méthode + suffix.
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

// methodOnly renvoie 405 pour toute méthode autre que celle attendue.
// OPTIONS est laissé passer pour ne pas court-circuiter le CORS middleware
// (qui répond 204 lui-même).
func methodOnly(method string, h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			h.ServeHTTP(w, r)
			return
		}
		if r.Method != method {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h.ServeHTTP(w, r)
	})
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
