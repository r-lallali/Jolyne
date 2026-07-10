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

// RegisterAIUsage expose les compteurs de consommation de l'API Claude,
// ventilés par poste de dépense (bot, moderation, translate, grammar,
// analyzer, icebreaker…). Renvoie l'observateur à brancher sur
// claudeapi.WithUsageFunc — signature en types simples pour que ni metrics ni
// claudeapi ne dépendent l'un de l'autre. C'est LA source de vérité pour
// arbitrer les optimisations de coût IA (cache, batch, modèle local).
func (m *Metrics) RegisterAIUsage() func(feature, outcome string, inputTokens, outputTokens int64) {
	reqs := prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "jolyne_ai_requests_total",
		Help: "Appels à l'API Claude par poste de dépense et issue (ok/error).",
	}, []string{"feature", "outcome"})
	tokens := prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "jolyne_ai_tokens_total",
		Help: "Tokens Claude facturés par poste de dépense et direction (input/output).",
	}, []string{"feature", "direction"})
	m.reg.MustRegister(reqs, tokens)
	return func(feature, outcome string, inputTokens, outputTokens int64) {
		reqs.WithLabelValues(feature, outcome).Inc()
		if inputTokens > 0 {
			tokens.WithLabelValues(feature, "input").Add(float64(inputTokens))
		}
		if outputTokens > 0 {
			tokens.WithLabelValues(feature, "output").Add(float64(outputTokens))
		}
	}
}

// RegisterLabeledCounter expose un compteur à un label et renvoie son
// incrémenteur — hook en types simples pour ne pas propager Prometheus dans
// les autres packages (ex : étage décideur de la cascade de modération).
func (m *Metrics) RegisterLabeledCounter(name, help, label string) func(value string) {
	c := prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: name,
		Help: help,
	}, []string{label})
	m.reg.MustRegister(c)
	return func(value string) { c.WithLabelValues(value).Inc() }
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
