package main

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/ws"
)

// services regroupe les dépendances utilisées par les handlers HTTP.
type services struct {
	rdb       *redis.Client
	pg        *pgxpool.Pool // nil si POSTGRES_DSN non renseigné
	wsHandler *ws.Handler
}

func routes(s services) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", healthz(s))
	mux.Handle("GET /ws/match", s.wsHandler)
	return mux
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
