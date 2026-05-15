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
		Log:     log,
	})

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
