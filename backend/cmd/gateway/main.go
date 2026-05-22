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
	"github.com/ralys/jolyne/backend/internal/blocking"
	"github.com/ralys/jolyne/backend/internal/config"
	"github.com/ralys/jolyne/backend/internal/crypto"
	"github.com/ralys/jolyne/backend/internal/db"
	"github.com/ralys/jolyne/backend/internal/friends"
	"github.com/ralys/jolyne/backend/internal/grammar"
	"github.com/ralys/jolyne/backend/internal/mailer"
	"github.com/ralys/jolyne/backend/internal/matcher"
	"github.com/ralys/jolyne/backend/internal/moderation"
	"github.com/ralys/jolyne/backend/internal/obs"
	"github.com/ralys/jolyne/backend/internal/profile"
	"github.com/ralys/jolyne/backend/internal/quota"
	"github.com/ralys/jolyne/backend/internal/redisx"
	"github.com/ralys/jolyne/backend/internal/reports"
	"github.com/ralys/jolyne/backend/internal/translate"
	"github.com/ralys/jolyne/backend/internal/users"
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

	svc := services{rdb: rdb, publicCORS: cfg.PublicCORSOrigin}

	if cfg.LibreTranslateURL != "" {
		svc.translate = &translate.Handler{
			Client: translate.NewClient(cfg.LibreTranslateURL, cfg.LibreTranslateAPIKey),
		}
		log.Info("translate endpoint ready", "url", cfg.LibreTranslateURL)
	} else {
		log.Info("translate désactivé — LIBRETRANSLATE_URL non renseigné")
	}

	if cfg.LanguageToolURL != "" {
		svc.grammar = &grammar.Handler{Client: grammar.NewClient(cfg.LanguageToolURL)}
		log.Info("grammar endpoint ready", "url", cfg.LanguageToolURL)
	} else {
		log.Info("grammar désactivé — LANGUAGETOOL_URL non renseigné")
	}

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

	wsDeps := ws.Deps{
		RDB:      rdb,
		Matcher:  matcher.New(rdb),
		Hub:      ws.NewHub(),
		Quota:    quota.NewEngine(rdb, nil),
		Block:    moderation.DefaultBlocklist(),
		Reports:  reportSvc,
		Bans:     banSvc,
		Blocking: blocking.New(rdb),
		Log:      log,
	}
	if svc.pg != nil {
		wsDeps.Friends = friends.NewStore(svc.pg)
	}
	if userSessionSecret != nil {
		wsDeps.UserAuth = &ws.UserAuth{
			CookieName:    users.SessionCookieName,
			SessionSecret: userSessionSecret,
			Verify: func(token string, secret []byte) (int64, error) {
				s, err := users.VerifySession(token, secret)
				if err != nil {
					return 0, err
				}
				return s.UserID, nil
			},
		}
	}
	svc.wsHandler = ws.NewHandler(wsDeps)

	// Back-office admin. Désactivé si POSTGRES_DSN/ADMIN_USERS/ADMIN_SESSION_SECRET
	// ne sont pas tous renseignés.
	if svc.pg != nil && cfg.AdminUsersRaw != "" && cfg.AdminSessionKey != "" {
		adminUsers, err := admin.ParseUsers(cfg.AdminUsersRaw)
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
				Users:         adminUsers,
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
			"users", len(adminUsers),
			"emails", admin.LoadedEmails(adminUsers),
			"ip_allowlist", len(allowlist),
			"cookie_domain", cfg.AdminCookieDomain)
	} else {
		log.Info("admin back-office disabled — Postgres / ADMIN_USERS / ADMIN_SESSION_SECRET manquants")
	}

	// Auth utilisateur (email + mot de passe). Désactivée si Postgres absent
	// OU USER_SESSION_SECRET vide (secret décodé plus haut). Mailjet est
	// OPTIONNEL en dev : si non configuré, le lien est juste loggé.
	if userSessionSecret != nil {
		ml := mailer.New(mailer.Config{
			Host:     cfg.MailjetSMTPHost,
			Port:     cfg.MailjetSMTPPort,
			Username: cfg.MailjetAPIKey,
			Password: cfg.MailjetSecret,
			From:     cfg.MailjetFrom,
		})
		// Profile store créé avant users.Handlers pour pouvoir l'injecter
		// (signup → store display_name immédiatement).
		cld := profile.CloudinaryConfig{
			CloudName: cfg.CloudinaryCloudName,
			APIKey:    cfg.CloudinaryAPIKey,
			APISecret: cfg.CloudinaryAPISecret,
			Folder:    cfg.CloudinaryFolder,
		}
		profileStore := profile.NewStore(svc.pg)
		svc.users = &users.Handlers{
			Store:         users.NewStore(svc.pg),
			Profile:       profileStore,
			Mailer:        ml,
			SessionSecret: userSessionSecret,
			CookieDomain:  cfg.UserCookieDomain,
			CookieSecure:  cfg.IsProd(),
			PublicURL:     cfg.PublicAppURL,
			Log:           log,
			OnUserAuthenticated: func(ctx context.Context, userID int64, fingerprint string) {
				friends.ResolvePendingFriendships(ctx, rdb, wsDeps.Friends, userID, fingerprint, log)
			},
		}
		log.Info("user auth ready",
			"mailer", ml != nil,
			"cookie_domain", cfg.UserCookieDomain,
			"public_url", cfg.PublicAppURL)

		profileVerifier := profile.NewVerifier(profileStore, cld, log)
		svc.profile = &profile.Handlers{
			Store:      profileStore,
			Cloudinary: cld,
			Verifier:   profileVerifier,
			Log:        log,
		}
		// On branche le store profil au handler WS pour pouvoir pousser
		// peer_profile au match quand le peer est authentifié.
		wsDeps.Profiles = profileStore
		svc.wsHandler = ws.NewHandler(wsDeps)
		log.Info("profile endpoints ready", "cloudinary", cld.IsConfigured())

		// Friends : amitiés mutuelles + chats persistés. On réutilise le
		// même Friends.Store que wsDeps pour cohérence (deux instances
		// fonctionneraient mais autant éviter).
		svc.friends = &friends.Handlers{
			Store:   wsDeps.Friends,
			Profile: profileStore,
			Reports: reportSvc,
			Log:     log,
		}
		log.Info("friends endpoints ready")

		// WS friend chat : /ws/friend/{id} — persisté, push temps-réel.
		if wsDeps.Friends != nil && wsDeps.UserAuth != nil {
			svc.wsFriendHandler = ws.NewFriendHandler(ws.FriendDeps{
				RDB:      rdb,
				Friends:  wsDeps.Friends,
				UserAuth: wsDeps.UserAuth,
				Log:      log,
			})
			svc.wsInboxHandler = ws.NewInboxHandler(ws.InboxDeps{
				RDB:      rdb,
				Friends:  wsDeps.Friends,
				UserAuth: wsDeps.UserAuth,
				Log:      log,
			})
			log.Info("friend ws handler ready")
		}
	} else {
		log.Info("user auth disabled — Postgres / USER_SESSION_SECRET manquants")
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
