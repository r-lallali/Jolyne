package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"encoding/base64"

	sentry "github.com/getsentry/sentry-go"

	"github.com/ralys/jolyne/backend/internal/admin"
	"github.com/ralys/jolyne/backend/internal/analytics"
	"github.com/ralys/jolyne/backend/internal/bans"
	"github.com/ralys/jolyne/backend/internal/blocking"
	"github.com/ralys/jolyne/backend/internal/config"
	"github.com/ralys/jolyne/backend/internal/crypto"
	"github.com/ralys/jolyne/backend/internal/db"
	"github.com/ralys/jolyne/backend/internal/friends"
	"github.com/ralys/jolyne/backend/internal/matcher"
	"github.com/ralys/jolyne/backend/internal/metrics"
	"github.com/ralys/jolyne/backend/internal/moderation"
	"github.com/ralys/jolyne/backend/internal/obs"
	"github.com/ralys/jolyne/backend/internal/quota"
	"github.com/ralys/jolyne/backend/internal/redisx"
	"github.com/ralys/jolyne/backend/internal/reports"
	"github.com/ralys/jolyne/backend/internal/users"
	"github.com/ralys/jolyne/backend/internal/ws"
)

// Build metadata injectée via -ldflags au moment du `go build`. Vide en
// build local sans linker args — on log "dev" pour distinguer.
var (
	buildCommit  = "dev"
	buildVersion = "dev"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "gateway: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}

	log := obs.NewLogger(cfg.Env)
	// Sentry : chaque log de niveau Error part aussi vers Sentry (message +
	// attributs — la taxonomie des logs est garantie sans contenu ni PII,
	// règles d'or #1/#6). Sans DSN, comportement inchangé.
	if cfg.SentryDSN != "" {
		if err := sentry.Init(sentry.ClientOptions{
			Dsn:            cfg.SentryDSN,
			Environment:    cfg.Env,
			Release:        buildCommit,
			SendDefaultPII: false,
		}); err != nil {
			log.Warn("sentry init failed — forwarding désactivé", "err", err)
		} else {
			defer sentry.Flush(2 * time.Second)
			log = obs.WithErrorForwarding(log, func(msg string, attrs map[string]string) {
				sentry.WithScope(func(scope *sentry.Scope) {
					logCtx := make(sentry.Context, len(attrs))
					for k, v := range attrs {
						logCtx[k] = v
					}
					scope.SetContext("log", logCtx)
					scope.SetLevel(sentry.LevelError)
					sentry.CaptureMessage(msg)
				})
			})
		}
	}
	slog.SetDefault(log)
	log.Info("gateway boot",
		"env", cfg.Env,
		"port", cfg.Port,
		"commit", buildCommit,
		"version", buildVersion,
		"sentry", cfg.SentryDSN != "")

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	rdb, err := redisx.New(ctx, redisx.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})
	if err != nil {
		return fmt.Errorf("redis: %w", err)
	}
	defer rdb.Close()

	svc := services{rdb: rdb, publicCORS: cfg.PublicCORSOrigin, hsts: cfg.IsProd()}

	// Vars partagées entre blocs conditionnels et le câblage final (analytics,
	// métriques, données live du back-office).
	startedAt := time.Now()
	var (
		resolveUserID   func(r *http.Request) int64 // nil si auth user désactivée
		adminAllowlist  []*net.IPNet                // allowlist admin, réutilisée pour /metrics
		adminEmails     map[string]struct{}         // emails admin (séparation stricte admin/user)
		analysisBatcher *ws.AnalysisBatcher         // nil hors mode batch — drainé au shutdown
	)

	// Métriques Prometheus créées AVANT le câblage des clients IA : chaque
	// client Claude est branché sur l'observateur d'usage (tokens + requêtes
	// par poste de dépense) — indispensable pour arbitrer les coûts IA.
	met := metrics.New()
	aiUsage := met.RegisterAIUsage()

	// Handlers traduction/grammaire (LibreTranslate/LanguageTool + repli IA).
	svc.translate = wireTranslate(cfg, log, rdb, aiUsage)
	svc.grammar = wireGrammar(cfg, log, rdb, aiUsage)

	// Postgres : optionnel pour l'instant. Si POSTGRES_DSN n'est pas set,
	// le gateway boot sans — les features Phase 2 dépendantes (signalements,
	// bans persistants) ne seront simplement pas servies. Le DSN deviendra
	// obligatoire quand on activera les endpoints qui en dépendent.
	var reportSvc *reports.Service
	var banSvc *bans.Service
	if cfg.PostgresDSN != "" {
		if cfg.PostgresMigrate {
			log.Info("postgres migrations running")
			if err := db.RunMigrations(cfg.PostgresDSN); err != nil {
				return fmt.Errorf("postgres migrate: %w", err)
			}
			log.Info("postgres migrations applied")
		}
		pool, err := db.New(ctx, cfg.PostgresDSN)
		if err != nil {
			return fmt.Errorf("postgres: %w", err)
		}
		defer pool.Close()
		svc.pg = pool
		log.Info("postgres connected")

		// Bans : ne dépend que de Postgres. Toujours activé avec une DB.
		banSvc = bans.NewService(pool)

		// Reports nécessite Postgres ET la clé AES. Sans clé → on log et
		// on désactive proprement (les clients qui essaient verront une
		// erreur 'signalement désactivé').
		if cfg.ReportEncryptionKey != "" {
			box, err := crypto.NewBox(cfg.ReportEncryptionKey)
			if err != nil {
				return fmt.Errorf("report key: %w", err)
			}
			reportSvc = reports.NewService(pool, box)
			log.Info("reports service ready")
		} else {
			log.Warn("reports désactivés — REPORT_ENCRYPTION_KEY manquant")
		}
	} else {
		log.Warn("postgres skipped — POSTGRES_DSN non renseigné")
	}

	// Décode le secret session user en amont pour pouvoir le passer à
	// la fois au ws.Handler (qui résout le cookie au handshake) et aux
	// users.Handlers (qui le signent).
	var userSessionSecret []byte
	if svc.pg != nil && cfg.UserSessionKey != "" {
		s, err := base64.StdEncoding.DecodeString(cfg.UserSessionKey)
		if err != nil || len(s) < 32 {
			return fmt.Errorf("user session secret: must be base64 ≥32 bytes")
		}
		userSessionSecret = s
	}

	// Tracker analytics : écrit les events (funnel/rétention) en base de façon
	// asynchrone. Nil-safe si Postgres absent. Flush au shutdown.
	tracker := analytics.NewTracker(svc.pg, log)
	defer tracker.Close()

	// IP cliente réelle : source unique (netx) tenant compte des proxies
	// frontaux. Configuré ici pour l'admin (package var), puis passé au WS et
	// au beacon via leurs structs respectives.
	admin.SetTrustedProxies(cfg.TrustedProxies)

	// Anti-CSWSH : le handshake WS n'est accepté que depuis l'origine du front
	// public (et l'origine admin). Vide en dev → contrôle désactivé.
	ws.SetAllowedOrigins([]string{cfg.PublicCORSOrigin, cfg.AdminCORSOrigin, cfg.PublicAppURL})

	// Préférence de niveau CECRL au matching (flag MATCH_LEVEL_AWARE).
	m := matcher.New(rdb)
	m.LevelAware = cfg.MatchLevelAware
	if cfg.MatchLevelAware {
		log.Info("level-aware matching enabled")
	}

	wsDeps := ws.Deps{
		RDB:            rdb,
		Matcher:        m,
		Hub:            ws.NewHub(),
		Quota:          quota.NewEngine(rdb, nil),
		Block:          moderation.DefaultBlocklist(),
		Reports:        reportSvc,
		Bans:           banSvc,
		Blocking:       blocking.New(rdb),
		Tracker:        tracker,
		TrustedProxies: cfg.TrustedProxies,
		Log:            log,
	}
	// Le quota traduction partage le même moteur Redis. Branché même sans auth
	// user : les anonymes sont décomptés par fingerprint (en-tête X-Device-FP).
	if svc.translate != nil {
		svc.translate.Quota = wsDeps.Quota
	}
	// État des compteurs (GET /api/quota) : même moteur Redis. Monté même sans
	// auth — les anonymes sont décomptés par fingerprint. ResolveUserID /
	// IsPremium sont branchés plus bas si l'auth user est active.
	svc.quota = &quota.Handler{Engine: wsDeps.Quota}
	if svc.pg != nil {
		wsDeps.Friends = friends.NewStore(svc.pg)
	}
	if userSessionSecret != nil {
		wsDeps.UserAuth = &ws.UserAuth{
			CookieName:    users.SessionCookieName,
			SessionSecret: userSessionSecret,
			Verify: func(token string, secret []byte) (int64, int64, error) {
				s, err := users.VerifySession(token, secret)
				if err != nil {
					return 0, 0, err
				}
				return s.UserID, s.Version, nil
			},
			// ValidateVersion est branché plus bas, une fois usersStore créé.
		}
	}
	svc.wsHandler = ws.NewHandler(wsDeps)

	// Back-office admin — désactivé (nil) sans Postgres/ADMIN_USERS/secret.
	svc.admin, adminAllowlist, adminEmails, err = wireAdmin(cfg, svc.pg, banSvc, log, startedAt)
	if err != nil {
		return err
	}

	// Auth utilisateur et tout ce qui en dépend (profil, amis, billing,
	// carnet, mode Cours, push, bot prof IA, analyse post-chat). Désactivée
	// si Postgres absent OU USER_SESSION_SECRET vide (secret décodé plus
	// haut). Voir wire_users.go.
	if userSessionSecret != nil {
		resolveUserID, analysisBatcher = wireUserStack(ctx, userStackDeps{
			cfg:         cfg,
			log:         log,
			rdb:         rdb,
			met:         met,
			aiUsage:     aiUsage,
			tracker:     tracker,
			reports:     reportSvc,
			bans:        banSvc,
			secret:      userSessionSecret,
			adminEmails: adminEmails,
		}, &svc, &wsDeps)
	} else {
		log.Info("user auth disabled — Postgres / USER_SESSION_SECRET manquants")
	}

	// --- Métriques Prometheus (créées en tête de run) + beacon analytics +
	// données live du back-office.
	met.RegisterPoolStats(svc.pg)
	if svc.wsHandler != nil {
		met.RegisterGauge("jolyne_ws_online", "Connexions WebSocket actives.",
			func() float64 { return float64(svc.wsHandler.Online()) })
		met.RegisterGauge("jolyne_ws_searching", "Sessions en attente d'un peer.",
			func() float64 { return float64(wsDeps.Hub.Len()) })
	}
	svc.metrics = met
	svc.metricsAllow = adminAllowlist

	// Beacon public : page_view / signup_started / match_search_started. Présent
	// dès que le Tracker l'est (Postgres). ResolveUser nil si auth user inactive.
	if tracker != nil {
		svc.beacon = &analytics.Beacon{
			Tracker:        tracker,
			Quota:          wsDeps.Quota,
			ResolveUser:    resolveUserID,
			TrustedProxies: cfg.TrustedProxies,
			Log:            log,
		}
	}

	// Données live du back-office (non persistées). Injectées après finalisation
	// du wsHandler pour que les jauges lisent le bon pointeur.
	if svc.admin != nil {
		svc.admin.Online = func() int { return int(svc.wsHandler.Online()) }
		svc.admin.Searching = func() int { return wsDeps.Hub.Len() }
		svc.admin.Queues = func(ctx context.Context) []admin.QueueDepth { return queueDepths(ctx, rdb) }
		svc.admin.PoolStats = func() map[string]int64 { return poolStats(svc.pg) }
		svc.admin.Health = func(ctx context.Context) map[string]string { return healthSnapshot(ctx, rdb, svc.pg) }
	}

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           routes(svc),
		ReadHeaderTimeout: 5 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("http listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return fmt.Errorf("http: %w", err)
	case <-ctx.Done():
		log.Info("shutdown signal received")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownGrace)
	defer cancel()
	shutdownErr := srv.Shutdown(shutdownCtx)
	// Drain des analyses encore en file, sur le budget de grâce restant :
	// jamais persistées (règle d'or #1), c'est maintenant ou perdu.
	if analysisBatcher != nil {
		analysisBatcher.Drain(shutdownCtx)
	}
	if shutdownErr != nil {
		return fmt.Errorf("shutdown: %w", shutdownErr)
	}
	log.Info("gateway stopped")
	return nil
}
