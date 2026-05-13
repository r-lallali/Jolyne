package obs

// Le package obs centralise observabilité : logs structurés (log.go) et
// métriques Prometheus (à venir). Phase 0 = squelette uniquement.
//
// Cibles métriques (Phase 1+) :
//   - jolyne_ws_connections (gauge)
//   - jolyne_match_attempts_total{result="matched|queued|timeout"} (counter)
//   - jolyne_match_duration_seconds (histogram)
//   - jolyne_queue_size{pair} (gauge)
//   - jolyne_next_total{plan="free|premium"} (counter)
//   - jolyne_quota_blocked_total{type="next|translate"} (counter)
//   - jolyne_redis_cleanup_total (counter)
