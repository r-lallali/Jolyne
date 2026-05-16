package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"encoding/base64"

	"github.com/ralys/jolyne/backend/internal/admin"
	"github.com/ralys/jolyne/backend/internal/bans"
	"github.com/ralys/jolyne/backend/internal/config"
	"github.com/ralys/jolyne/backend/internal/crypto"
	"github.com/ralys/jolyne/backend/internal/db"
	"github.com/ralys/jolyne/backend/internal/matcher"
	"github.com/ralys/jolyne/backend/internal/moderation"
	"github.com/ralys/jolyne/backend/internal/obs"
	"github.com/ralys/jolyne/backend/internal/quota"
	"github.com/ralys/jolyne/backend/internal/redisx"
	"github.com/ralys/jolyne/backend/internal/reports"
	"github.com/ralys/jolyne/backend/internal/ws"
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
	slog.SetDefault(log)
	log.Info("gateway boot", "env", cfg.Env, "port", cfg.Port)

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

	svc := services{rdb: rdb}

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

	svc.wsHandler = ws.NewHandler(ws.Deps{
		RDB:     rdb,
		Matcher: matcher.New(rdb),
		Hub:     ws.NewHub(),
		Quota:   quota.NewEngine(rdb, nil),
		Block:   moderation.DefaultBlocklist(),
		Reports: reportSvc,
		Bans:    banSvc,
		Log:     log,
	})

	// Back-office admin. Désactivé si POSTGRES_DSN/ADMIN_USERS/ADMIN_SESSION_SECRET
	// ne sont pas tous renseignés.
	if svc.pg != nil && cfg.AdminUsersRaw != "" && cfg.AdminSessionKey != "" {
		users, err := admin.ParseUsers(cfg.AdminUsersRaw)
		if err != nil {
			return fmt.Errorf("admin users: %w", err)
		}
		allowlist, err := admin.ParseIPAllowlist(cfg.AdminIPAllowlist)
		if err != nil {
			return fmt.Errorf("admin allowlist: %w", err)
		}
		secret, err := base64.StdEncoding.DecodeString(cfg.AdminSessionKey)
		if err != nil || len(secret) < 32 {
			return fmt.Errorf("admin session secret: must be base64 ≥32 bytes")
		}
		// Reports.box est nil-safe — l'admin ne déchiffre que si la clé est
		// présente. On réutilise la même box que reports.
		var box *crypto.Box
		if cfg.ReportEncryptionKey != "" {
			box, _ = crypto.NewBox(cfg.ReportEncryptionKey)
		}
		svc.admin = &admin.Handlers{
			Cfg: admin.Config{
				Users:         users,
				IPAllowlist:   allowlist,
				SessionSecret: secret,
				CookieDomain:  cfg.AdminCookieDomain,
				CookieSecure:  cfg.IsProd(),
				CORSOrigin:    cfg.AdminCORSOrigin,
			},
			Store: admin.NewStore(svc.pg, box),
			Bans:  banSvc,
			Log:   log,
		}
		log.Info("admin back-office ready",
			"users", len(users),
			"emails", admin.LoadedEmails(users),
			"ip_allowlist", len(allowlist),
			"cookie_domain", cfg.AdminCookieDomain)
	} else {
		log.Info("admin back-office disabled — Postgres / ADMIN_USERS / ADMIN_SESSION_SECRET manquants")
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
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	log.Info("gateway stopped")
	return nil
}
