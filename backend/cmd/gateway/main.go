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
	"strconv"
	"strings"
	"syscall"
	"time"

	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/admin"
	"github.com/ralys/jolyne/backend/internal/analytics"
	"github.com/ralys/jolyne/backend/internal/bans"
	"github.com/ralys/jolyne/backend/internal/billing"
	"github.com/ralys/jolyne/backend/internal/blocking"
	"github.com/ralys/jolyne/backend/internal/claudeapi"
	"github.com/ralys/jolyne/backend/internal/config"
	"github.com/ralys/jolyne/backend/internal/crypto"
	"github.com/ralys/jolyne/backend/internal/db"
	"github.com/ralys/jolyne/backend/internal/friends"
	"github.com/ralys/jolyne/backend/internal/grammar"
	"github.com/ralys/jolyne/backend/internal/learn"
	"github.com/ralys/jolyne/backend/internal/mailer"
	"github.com/ralys/jolyne/backend/internal/matcher"
	"github.com/ralys/jolyne/backend/internal/metrics"
	"github.com/ralys/jolyne/backend/internal/moderation"
	"github.com/ralys/jolyne/backend/internal/netx"
	"github.com/ralys/jolyne/backend/internal/obs"
	"github.com/ralys/jolyne/backend/internal/profile"
	"github.com/ralys/jolyne/backend/internal/push"
	"github.com/ralys/jolyne/backend/internal/quota"
	"github.com/ralys/jolyne/backend/internal/redisx"
	"github.com/ralys/jolyne/backend/internal/reports"
	"github.com/ralys/jolyne/backend/internal/session"
	"github.com/ralys/jolyne/backend/internal/translate"
	"github.com/ralys/jolyne/backend/internal/users"
	"github.com/ralys/jolyne/backend/internal/vocab"
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
	slog.SetDefault(log)
	log.Info("gateway boot",
		"env", cfg.Env,
		"port", cfg.Port,
		"commit", buildCommit,
		"version", buildVersion)

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

	// Vars partagées entre blocs conditionnels et le câblage final (analytics,
	// métriques, données live du back-office).
	startedAt := time.Now()
	var (
		resolveUserID  func(r *http.Request) int64 // nil si auth user désactivée
		adminAllowlist []*net.IPNet                // allowlist admin, réutilisée pour /metrics
		adminEmails    map[string]struct{}         // emails admin (séparation stricte admin/user)
	)

	if cfg.LibreTranslateURL != "" {
		svc.translate = &translate.Handler{
			Client: translate.NewClient(cfg.LibreTranslateURL, cfg.LibreTranslateAPIKey),
			// Cache partagé des traductions (clé hashée, valeur sans identité
			// user) : un hit ne consomme ni upstream ni quota.
			RDB: rdb,
		}
		// Traducteur IA pour les phrases (repli LibreTranslate sur erreur).
		// Client dédié : plafond de tokens relevé vs le prof IA (traduction
		// + romanisation d'un texte de 500 runes > 256 tokens).
		if cfg.AnthropicAPIKey != "" {
			aiClient := claudeapi.New(cfg.AnthropicAPIKey,
				claudeapi.WithModel(cfg.AnthropicModel),
				claudeapi.WithLogger(log),
				claudeapi.WithMaxTokens(1024),
			)
			svc.translate.AI = &translate.AITranslator{
				Reply: func(ctx context.Context, system, userMsg string) (string, error) {
					return aiClient.Reply(ctx, system, nil, userMsg)
				},
			}
		}
		log.Info("translate endpoint ready",
			"url", cfg.LibreTranslateURL,
			"ai_phrases", cfg.AnthropicAPIKey != "",
		)
	} else {
		log.Info("translate désactivé — LIBRETRANSLATE_URL non renseigné")
	}

	if cfg.LanguageToolURL != "" {
		svc.grammar = &grammar.Handler{
			Client: grammar.NewClient(cfg.LanguageToolURL),
			// Cache partagé des vérifications (clé hashée, valeur sans
			// identité user) : un hit ne touche pas LanguageTool.
			RDB: rdb,
		}
		// Correcteur IA pour les langues hors LanguageTool (coréen). Client
		// dédié : la liste JSON de corrections dépasse les 256 tokens du
		// prof IA.
		if cfg.AnthropicAPIKey != "" {
			aiClient := claudeapi.New(cfg.AnthropicAPIKey,
				claudeapi.WithModel(cfg.AnthropicModel),
				claudeapi.WithLogger(log),
				claudeapi.WithMaxTokens(1024),
			)
			svc.grammar.AI = &grammar.AIChecker{
				Reply: func(ctx context.Context, system, userMsg string) (string, error) {
					return aiClient.Reply(ctx, system, nil, userMsg)
				},
			}
		}
		log.Info("grammar endpoint ready",
			"url", cfg.LanguageToolURL,
			"ai_langs", cfg.AnthropicAPIKey != "",
		)
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

	// Back-office admin. Désactivé si POSTGRES_DSN/ADMIN_USERS/ADMIN_SESSION_SECRET
	// ne sont pas tous renseignés.
	if svc.pg != nil && cfg.AdminUsersRaw != "" && cfg.AdminSessionKey != "" {
		adminUsers, err := admin.ParseUsers(cfg.AdminUsersRaw)
		if err != nil {
			return fmt.Errorf("admin users: %w", err)
		}
		// Set des emails admin (déjà en minuscules) — sert à empêcher qu'une
		// même adresse soit à la fois admin et compte user.
		adminEmails = make(map[string]struct{}, len(adminUsers))
		for _, e := range admin.LoadedEmails(adminUsers) {
			adminEmails[e] = struct{}{}
		}
		adminAllowlist, err = admin.ParseIPAllowlist(cfg.AdminIPAllowlist)
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
				Users:               adminUsers,
				IPAllowlist:         adminAllowlist,
				SessionSecret:       secret,
				CookieDomain:        cfg.AdminCookieDomain,
				CookieSecure:        cfg.IsProd(),
				CORSOrigin:          cfg.AdminCORSOrigin,
				PremiumMonthlyCents: parseEnvCents("PREMIUM_MONTHLY_CENTS"),
			},
			Store:     admin.NewStore(svc.pg, box),
			Bans:      banSvc,
			Log:       log,
			StartedAt: startedAt,
		}
		// Pas d'email en clair dans les logs (règle d'or #6). On garde
		// uniquement les empreintes (8 octets hex) pour pouvoir corréler
		// un user admin précis en cas de besoin sans révéler l'adresse.
		log.Info("admin back-office ready",
			"users", len(adminUsers),
			"email_hashes", hashEmails(admin.LoadedEmails(adminUsers)),
			"ip_allowlist", len(adminAllowlist),
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
		usersStore := users.NewStore(svc.pg)

		// Révocation de session côté WS : le cookie porte une version signée,
		// confrontée à la version courante en base (bumpée au reset de mot de
		// passe). Fail-open sur erreur DB (la signature reste vérifiée) pour ne
		// pas déconnecter tout le monde sur un hoquet Postgres.
		if wsDeps.UserAuth != nil {
			wsDeps.UserAuth.ValidateVersion = func(ctx context.Context, userID, version int64) bool {
				cur, err := usersStore.SessionVersion(ctx, userID)
				if err != nil {
					return true
				}
				return version == cur
			}
		}
		svc.users = &users.Handlers{
			Store:         usersStore,
			Profile:       profileStore,
			Mailer:        ml,
			SessionSecret: userSessionSecret,
			CookieDomain:  cfg.UserCookieDomain,
			CookieSecure:  cfg.IsProd(),
			PublicURL:     cfg.PublicAppURL,
			Log:           log,
			Tracker:       tracker,
			IsAdminEmail: func(email string) bool {
				if adminEmails == nil {
					return false
				}
				_, ok := adminEmails[strings.ToLower(strings.TrimSpace(email))]
				return ok
			},
			// Rate-limit anti-abus (brute-force login, spam signup, email-bombing
			// forgot) partageant le moteur quota Redis, clé par IP réelle.
			RateLimiter: wsDeps.Quota,
			ClientIP:    func(r *http.Request) string { return netx.ClientIP(r, cfg.TrustedProxies) },
			OnUserAuthenticated: func(ctx context.Context, userID int64, fingerprint string) {
				friends.ResolvePendingFriendships(ctx, rdb, wsDeps.Friends, userID, fingerprint, log)
			},
		}
		log.Info("user auth ready",
			"mailer", ml != nil,
			"cookie_domain", cfg.UserCookieDomain,
			"public_url", cfg.PublicAppURL)

		// Résolveur de plan : Premium si abonnement Stripe actif. Partagé par
		// le WS (swipe quota) et le handler translate.
		isPremium := func(ctx context.Context, userID int64) bool {
			ok, err := usersStore.IsPremium(ctx, userID)
			if err != nil {
				log.Warn("is premium check", "err", err)
				return false
			}
			return ok
		}
		wsDeps.ResolvePlan = func(ctx context.Context, userID int64) session.Plan {
			if isPremium(ctx, userID) {
				return session.PlanPremium
			}
			return session.PlanFree
		}
		// Niveau CECRL estimé : préférence de matching + badge peer_profile +
		// calibrage du prof IA. 0 (inconnu) sur erreur — fail-soft.
		wsDeps.ResolveCEFR = func(ctx context.Context, userID int64) float64 {
			score, err := usersStore.CEFRScore(ctx, userID)
			if err != nil {
				log.Warn("cefr score resolve", "err", err)
				return 0
			}
			return score
		}
		// Résout le user via le cookie de session, pour appliquer le quota par
		// compte (ou le bypass Premium). Partagé par les handlers translate et
		// quota (état des compteurs).
		resolveUserID = func(r *http.Request) int64 {
			c, err := r.Cookie(users.SessionCookieName)
			if err != nil {
				return 0
			}
			s, err := users.VerifySession(c.Value, userSessionSecret)
			if err != nil {
				return 0
			}
			return s.UserID
		}
		if svc.translate != nil {
			svc.translate.IsPremium = isPremium
			svc.translate.ResolveUserID = resolveUserID
		}
		if svc.quota != nil {
			svc.quota.IsPremium = isPremium
			svc.quota.ResolveUserID = resolveUserID
		}

		// Billing Premium (Stripe). Actif seulement si la clé secrète + le
		// price sont configurés. Success/Cancel/Return dérivés de PublicAppURL.
		if cfg.StripeSecretKey != "" && cfg.StripePriceID != "" {
			successURL := cfg.StripeSuccessURL
			if successURL == "" {
				successURL = cfg.PublicAppURL + "/premium/success"
			}
			cancelURL := cfg.StripeCancelURL
			if cancelURL == "" {
				cancelURL = cfg.PublicAppURL + "/premium/cancel"
			}
			svc.billing = &billing.Handlers{
				Stripe: billing.New(billing.Config{
					SecretKey:     cfg.StripeSecretKey,
					WebhookSecret: cfg.StripeWebhookSecret,
					PriceID:       cfg.StripePriceID,
					SuccessURL:    successURL,
					CancelURL:     cancelURL,
				}),
				Users:                 usersStore,
				Events:                billing.NewEventStore(svc.pg),
				ReturnURL:             cfg.PublicAppURL + "/account",
				Log:                   log,
				Tracker:               tracker,
				ResolveUserByCustomer: usersStore.UserIDByCustomerID,
			}
			log.Info("billing endpoints ready", "price", cfg.StripePriceID)
		} else {
			log.Info("billing désactivé — STRIPE_SECRET_KEY / STRIPE_PRICE_ID manquant")
		}

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

		// Stores carnet + learn créés tôt : partagés par leurs endpoints
		// respectifs ET l'analyse IA de fin de conversation (câblée dans le
		// bloc bot ci-dessous : vocabulaire → carnet, fautes → items de
		// révision de la leçon du jour).
		vocabStore := vocab.NewStore(svc.pg)
		learnStore := learn.NewStore(svc.pg)

		// Bot prof IA : si ANTHROPIC_API_KEY est posée, on instancie un
		// BotManager qui spawnera des bots après TriggerDelaySec si aucun
		// peer humain ne se connecte. Sinon comportement chat = avant.
		if cfg.AnthropicAPIKey != "" {
			claudeClient := claudeapi.New(cfg.AnthropicAPIKey,
				claudeapi.WithModel(cfg.AnthropicModel),
				claudeapi.WithLogger(log),
			)
			wsDeps.Bot = ws.NewBotManager(ws.BotManagerConfig{
				RDB:           rdb,
				Matcher:       wsDeps.Matcher,
				Hub:           wsDeps.Hub,
				Claude:        claudeClient,
				Quota:         wsDeps.Quota,
				Log:           log,
				TriggerDelay:  time.Duration(cfg.BotTriggerDelaySec) * time.Second,
				MaxConcurrent: cfg.BotMaxConcurrent,
				Tracker:       tracker,
				// Réactivation SRS : mots dus injectés dans le prompt du prof.
				DueWords: func(ctx context.Context, userID int64, lang string) []string {
					words, err := vocabStore.DueTerms(ctx, userID, lang, 5)
					if err != nil {
						log.Warn("bot due words", "err", err)
						return nil
					}
					return words
				},
			})
			// Modération IA du chat anonyme (hors chemin critique) : réutilise le
			// même client Claude. Avertit puis suspend les récidivistes.
			wsDeps.Toxicity = &ws.ToxicityGuard{
				Classifier: moderation.NewClassifier(claudeClient, log),
				RDB:        rdb,
				Bans:       banSvc,
				Tracker:    tracker,
				Log:        log,
			}
			// Amorces de conversation générées par Claude, cachées dans Redis
			// par langue pratiquée (TTL 6 h) — servies au match humain-humain.
			wsDeps.Icebreakers = &ws.IcebreakerService{
				Claude: claudeClient,
				RDB:    rdb,
				Log:    log,
			}
			// Analyse IA de fin de conversation : vocabulaire → carnet,
			// fautes corrigées → items de révision (leçon du jour), niveau
			// CECRL → profil user (EWMA). Réutilise le même client Claude.
			wsDeps.Analyzer = &ws.SessionAnalyzer{
				Claude: claudeClient,
				SaveWord: func(ctx context.Context, userID int64, term, translation, sourceLang, targetLang string) error {
					_, err := vocabStore.Add(ctx, userID, vocab.Entry{
						Term:        term,
						Translation: translation,
						SourceLang:  sourceLang,
						TargetLang:  targetLang,
					})
					return err
				},
				SaveMistake: learnStore.AddReviewItem,
				SaveCEFR:    usersStore.UpdateCEFR,
				DueTerms: func(ctx context.Context, userID int64, lang string) []string {
					words, err := vocabStore.DueTerms(ctx, userID, lang, 20)
					if err != nil {
						log.Warn("analyzer due terms", "err", err)
						return nil
					}
					return words
				},
				ReviewInContext: func(ctx context.Context, userID int64, lang string, terms []string) error {
					return vocabStore.ReviewTermsInContext(ctx, userID, lang, terms, time.Now())
				},
				Log: log,
			}
			log.Info("bot peer ready",
				"model", cfg.AnthropicModel,
				"trigger_delay_sec", cfg.BotTriggerDelaySec,
				"max_concurrent", cfg.BotMaxConcurrent,
			)
		} else {
			log.Info("bot peer disabled — ANTHROPIC_API_KEY missing")
		}

		svc.wsHandler = ws.NewHandler(wsDeps)
		log.Info("profile endpoints ready", "cloudinary", cld.IsConfigured())

		// Friends : amitiés mutuelles + chats persistés. On réutilise le
		// même Friends.Store que wsDeps pour cohérence (deux instances
		// fonctionneraient mais autant éviter).
		svc.friends = &friends.Handlers{
			Store:                wsDeps.Friends,
			Profile:              profileStore,
			Reports:              reportSvc,
			RDB:                  rdb,
			SystemMsgPublisher:   ws.PublishFriendSystemMessage(rdb),
			StreakFramePublisher: ws.PublishFriendStreak(rdb),
			Log:                  log,
		}
		log.Info("friends endpoints ready")

		// Carnet de vocabulaire : mots sauvegardés depuis le popover de
		// traduction (et le résumé IA de fin de conversation). Store partagé.
		svc.vocab = &vocab.Handlers{
			Store:   vocabStore,
			Tracker: tracker,
			Log:     log,
		}
		log.Info("vocab endpoints ready")

		// Mode Cours : contenu (cours/leçons) + progression/streak/cœurs/succès.
		// Dépend de Postgres + auth user. On (ré)applique au boot les 10 cours
		// dérivés de la matrice de curriculum (idempotent, réconcilié par slug —
		// la progression jouée est préservée). Le générateur Claude
		// (cmd/coursegen) peut enrichir/remplacer ensuite hors ligne.
		if err := learn.SeedCourses(ctx, learnStore, log); err != nil {
			log.Warn("learn seed", "err", err)
		}
		svc.learn = &learn.Handlers{
			Store:     learnStore,
			IsPremium: isPremium,      // cœurs illimités pour les abonnés
			Friends:   wsDeps.Friends, // validation amitié pour les demandes de cœur
			Tracker:   tracker,
			Log:       log,
		}
		log.Info("learn endpoints ready")

		// Web Push : Postgres-backed subscriptions + VAPID sender. Si une
		// des trois VAPID env n'est pas posée, le sender est laissé nil
		// (no-op) et les routes /api/notifications/* renvoient 503.
		var pushSender *push.Sender
		if cfg.VAPIDPublicKey != "" && cfg.VAPIDPrivateKey != "" && cfg.VAPIDSubject != "" {
			pushStore := push.NewStore(svc.pg)
			pushSender = &push.Sender{
				Store:     pushStore,
				VAPIDPub:  cfg.VAPIDPublicKey,
				VAPIDPriv: cfg.VAPIDPrivateKey,
				VAPIDSubj: cfg.VAPIDSubject,
				Log:       log,
			}
			svc.push = &push.Handlers{
				Store:    pushStore,
				VAPIDPub: cfg.VAPIDPublicKey,
				Log:      log,
			}
			log.Info("web push handler ready")
		} else {
			log.Info("web push disabled — VAPID env keys missing")
		}

		// Le mode Cours réutilise le sender push pour notifier les demandes /
		// dons de cœur entre amis (best-effort, nil-safe).
		if svc.learn != nil {
			svc.learn.Push = pushSender
		}

		// WS friend chat : /ws/friend/{id} — persisté, push temps-réel.
		if wsDeps.Friends != nil && wsDeps.UserAuth != nil {
			svc.wsFriendHandler = ws.NewFriendHandler(ws.FriendDeps{
				RDB:      rdb,
				Friends:  wsDeps.Friends,
				UserAuth: wsDeps.UserAuth,
				Push:     pushSender,
				Profile:  profileStore,
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

		// Cron de fin de streak : matérialise la perte d'un streak via une
		// ligne système permanente dans le chat ami. Tourne en goroutine,
		// indépendant du fait qu'un des deux amis soit connecté ou non.
		friends.StartStreakLossCron(
			ctx, svc.pg, log, 15*time.Minute,
			ws.PublishFriendSystemMessage(rdb),
		)
		log.Info("friend streak loss cron ready")

		// Cron de rappel de révision SRS : « X mots t'attendent dans ton
		// carnet ». Uniquement si le push est configuré (sinon no-op assuré).
		if pushSender != nil {
			vocab.StartReviewReminderCron(ctx, svc.pg, pushSender, log, 30*time.Minute)
			log.Info("vocab review reminder cron ready")
		}
	} else {
		log.Info("user auth disabled — Postgres / USER_SESSION_SECRET manquants")
	}

	// --- Métriques Prometheus + beacon analytics + données live du back-office.
	met := metrics.New()
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
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	log.Info("gateway stopped")
	return nil
}

// parseEnvCents lit une variable d'env en int64 (centimes). 0 si absente ou
// invalide — sert au calcul du MRR dans le dashboard revenus.
func parseEnvCents(key string) int64 {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return 0
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return 0
	}
	return n
}

// queueDepths balaie les files de matchmaking Redis (clés `queue:*`) et renvoie
// la profondeur de chacune. Best-effort, borné à 1 s.
func queueDepths(ctx context.Context, rdb *redis.Client) []admin.QueueDepth {
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	out := []admin.QueueDepth{}
	var cursor uint64
	for {
		keys, next, err := rdb.Scan(ctx, cursor, "queue:*", 100).Result()
		if err != nil {
			break
		}
		for _, k := range keys {
			n, err := rdb.ZCard(ctx, k).Result()
			if err != nil || n == 0 {
				continue
			}
			out = append(out, admin.QueueDepth{Pair: strings.TrimPrefix(k, "queue:"), Count: n})
		}
		if next == 0 {
			break
		}
		cursor = next
	}
	return out
}

// poolStats expose les compteurs du pool Postgres pour la page /admin/server.
func poolStats(pool *pgxpool.Pool) map[string]int64 {
	if pool == nil {
		return map[string]int64{}
	}
	s := pool.Stat()
	return map[string]int64{
		"acquired": int64(s.AcquiredConns()),
		"idle":     int64(s.IdleConns()),
		"total":    int64(s.TotalConns()),
		"max":      int64(s.MaxConns()),
	}
}

// healthSnapshot pingue Redis et Postgres (si présent) pour la bannière santé.
func healthSnapshot(ctx context.Context, rdb *redis.Client, pool *pgxpool.Pool) map[string]string {
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	out := map[string]string{"redis": "ok", "postgres": "n/a"}
	if err := rdb.Ping(ctx).Err(); err != nil {
		out["redis"] = "down"
	}
	if pool != nil {
		if err := pool.Ping(ctx); err != nil {
			out["postgres"] = "down"
		} else {
			out["postgres"] = "ok"
		}
	}
	return out
}

// hashEmails : SHA-256 tronqué à 8 octets (16 chars hex) par email,
// pour identifier un admin dans les logs sans exposer l'adresse.
// Conformité CLAUDE.md règle d'or #6 (pas de PII en clair).
func hashEmails(emails []string) []string {
	out := make([]string, 0, len(emails))
	for _, e := range emails {
		h := sha256.Sum256([]byte(e))
		out = append(out, hex.EncodeToString(h[:8]))
	}
	return out
}
