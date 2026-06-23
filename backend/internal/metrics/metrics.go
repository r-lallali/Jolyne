// Package metrics expose les métriques d'INFRASTRUCTURE au format Prometheus
// (/metrics) : latence/volume HTTP, runtime Go, pool Postgres, utilisateurs en
// ligne. Le funnel produit (inscription, match, premium…) vit ailleurs, dans la
// table `events` (cf. internal/analytics) — Prometheus reste réservé à
// l'opérationnel scrappable par Grafana.
package metrics

import (
	"bufio"
	"errors"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Metrics regroupe le registre Prometheus et les instruments HTTP. Construit
// une fois au démarrage, partagé par le middleware et le handler /metrics.
type Metrics struct {
	reg          *prometheus.Registry
	httpReqs     *prometheus.CounterVec
	httpDuration *prometheus.HistogramVec
}

// New crée le registre et y enregistre les collecteurs Go/process par défaut.
func New() *Metrics {
	reg := prometheus.NewRegistry()
	reg.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
	)
	m := &Metrics{
		reg: reg,
		httpReqs: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "jolyne_http_requests_total",
			Help: "Nombre de requêtes HTTP par méthode et code de statut.",
		}, []string{"method", "code"}),
		httpDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "jolyne_http_request_duration_seconds",
			Help:    "Latence des requêtes HTTP par méthode.",
			Buckets: prometheus.DefBuckets,
		}, []string{"method"}),
	}
	reg.MustRegister(m.httpReqs, m.httpDuration)
	return m
}

// Handler sert l'endpoint /metrics. À monter derrière l'IP allowlist admin.
func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.reg, promhttp.HandlerOpts{})
}

// Middleware instrumente toutes les requêtes HTTP (volume + latence). Le
// statusWriter relaie Hijack/Flush pour rester transparent vis-à-vis des
// upgrades WebSocket et du streaming SSE.
func (m *Metrics) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)
		m.httpReqs.WithLabelValues(r.Method, strconv.Itoa(sw.status)).Inc()
		m.httpDuration.WithLabelValues(r.Method).Observe(time.Since(start).Seconds())
	})
}

// RegisterPoolStats expose les statistiques du pool Postgres, lues à chaque
// scrape (GaugeFunc — pas de sampling périodique à maintenir).
func (m *Metrics) RegisterPoolStats(pool *pgxpool.Pool) {
	if pool == nil {
		return
	}
	m.reg.MustRegister(
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "jolyne_db_pool_acquired_conns",
			Help: "Connexions Postgres actuellement acquises.",
		}, func() float64 { return float64(pool.Stat().AcquiredConns()) }),
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "jolyne_db_pool_idle_conns",
			Help: "Connexions Postgres au repos.",
		}, func() float64 { return float64(pool.Stat().IdleConns()) }),
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "jolyne_db_pool_total_conns",
			Help: "Connexions Postgres ouvertes (total).",
		}, func() float64 { return float64(pool.Stat().TotalConns()) }),
		prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "jolyne_db_pool_max_conns",
			Help: "Plafond de connexions Postgres du pool.",
		}, func() float64 { return float64(pool.Stat().MaxConns()) }),
	)
}

// RegisterGauge expose une jauge calculée à la scrape (ex : utilisateurs en
// ligne lus depuis le Hub WS). Découple metrics des autres packages.
func (m *Metrics) RegisterGauge(name, help string, fn func() float64) {
	m.reg.MustRegister(prometheus.NewGaugeFunc(prometheus.GaugeOpts{
		Name: name,
		Help: help,
	}, fn))
}

// statusWriter capture le code HTTP tout en restant transparent pour les
// interfaces optionnelles utilisées par le WS (Hijacker) et le SSE (Flusher).
type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("metrics: ResponseWriter ne supporte pas Hijacker")
	}
	return h.Hijack()
}

func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
