package main

import (
	"encoding/json"
	"net/http"

	"github.com/redis/go-redis/v9"
)

// routes assemble le router HTTP du gateway.
// Les handlers métier (WS /ws/match, signalement, etc.) seront branchés ici
// au fur et à mesure des Phases — voir PLAN.md §4.
func routes(rdb *redis.Client) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", healthz(rdb))
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
