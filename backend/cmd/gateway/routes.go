package main

import (
	"encoding/json"
	"net/http"

	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/ws"
)

// services regroupe les dépendances utilisées par les handlers HTTP.
type services struct {
	rdb       *redis.Client
	wsHandler *ws.Handler
}

func routes(s services) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", healthz(s.rdb))
	mux.Handle("GET /ws/match", s.wsHandler)
	return mux
}

func healthz(rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		status := map[string]string{"status": "ok"}
		if err := rdb.Ping(r.Context()).Err(); err != nil {
			status["status"] = "degraded"
			status["redis"] = err.Error()
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(status)
	}
}
