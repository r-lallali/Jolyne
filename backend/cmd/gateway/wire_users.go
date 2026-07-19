package main

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/analytics"
	"github.com/ralys/jolyne/backend/internal/bans"
	"github.com/ralys/jolyne/backend/internal/billing"
	"github.com/ralys/jolyne/backend/internal/claudeapi"
	"github.com/ralys/jolyne/backend/internal/config"
	"github.com/ralys/jolyne/backend/internal/friends"
	"github.com/ralys/jolyne/backend/internal/learn"
	"github.com/ralys/jolyne/backend/internal/mailer"
	"github.com/ralys/jolyne/backend/internal/metrics"
	"github.com/ralys/jolyne/backend/internal/moderation"
	"github.com/ralys/jolyne/backend/internal/netx"
	"github.com/ralys/jolyne/backend/internal/profile"
	"github.com/ralys/jolyne/backend/internal/push"
	"github.com/ralys/jolyne/backend/internal/reports"
	"github.com/ralys/jolyne/backend/internal/session"
	"github.com/ralys/jolyne/backend/internal/users"
	"github.com/ralys/jolyne/backend/internal/vocab"
	"github.com/ralys/jolyne/backend/internal/ws"
)

// userStackDeps regroupe ce dont le câblage du compte utilisateur a besoin.
// Tout ce bloc est conditionné à Postgres + USER_SESSION_SECRET (le secret
// est déjà décodé par run()).
type userStackDeps struct {
	cfg         config.Config
	log         *slog.Logger
	rdb         *redis.Client
	met         *metrics.Metrics
	aiUsage     claudeapi.UsageFunc
	tracker     *analytics.Tracker
	reports     *reports.Service
	bans        *bans.Service
	secret      []byte              // session user (base64 décodé)
	adminEmails map[string]struct{} // séparation stricte admin / compte user
}

// wireUserStack câble tout ce qui dépend d'un compte : auth, profil, amis,
// billing, carnet, mode Cours, push, bot prof IA et analyse post-chat.
// Remplit svc et wsDeps en place ; renvoie le résolveur d'ID user (cookie)
// et le batcher d'analyses (nil hors mode batch) pour le drain au shutdown.
func wireUserStack(ctx context.Context, d userStackDeps, svc *services, wsDeps *ws.Deps) (func(r *http.Request) int64, *ws.AnalysisBatcher) {
	cfg, log, rdb := d.cfg, d.log, d.rdb
	var analysisBatcher *ws.AnalysisBatcher

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
		SessionSecret: d.secret,
		CookieDomain:  cfg.UserCookieDomain,
		CookieSecure:  cfg.IsProd(),
		PublicURL:     cfg.PublicAppURL,
		Log:           log,
		Tracker:       d.tracker,
		IsAdminEmail: func(email string) bool {
			if d.adminEmails == nil {
				return false
			}
			_, ok := d.adminEmails[strings.ToLower(strings.TrimSpace(email))]
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
	// Social login : chaque provider est actif si sa config complète est
	// posée (+ PUBLIC_API_URL pour les redirect URIs). nil →
	// /api/auth/oauth/providers renvoie une liste vide, aucun bouton au front.
	//
	// Apple est volontairement NON câblé pour l'instant (pas de compte Apple
	// Developer) : l'implémentation complète vit dans le package users
	// (oauth_provider.go / oauth_apple_secret.go). Pour l'activer :
	// décommenter les 4 champs Apple* ci-dessous et poser les env vars
	// APPLE_OAUTH_* (cf. README §Déploiement) — rien d'autre à toucher.
	svc.users.OAuth = users.NewOAuth(rdb, users.OAuthConfig{
		APIBaseURL:         cfg.PublicAPIURL,
		GoogleClientID:     cfg.GoogleOAuthClientID,
		GoogleClientSecret: cfg.GoogleOAuthClientSecret,
		// AppleClientID:   cfg.AppleOAuthClientID,
		// AppleTeamID:     cfg.AppleOAuthTeamID,
		// AppleKeyID:      cfg.AppleOAuthKeyID,
		// ApplePrivateKey: cfg.AppleOAuthPrivateKey,
	}, log)
	log.Info("user auth ready",
		"mailer", ml != nil,
		"cookie_domain", cfg.UserCookieDomain,
		"public_url", cfg.PublicAppURL,
		"oauth", svc.users.OAuth != nil)

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
	resolveUserID := func(r *http.Request) int64 {
		c, err := r.Cookie(users.SessionCookieName)
		if err != nil {
			return 0
		}
		s, err := users.VerifySession(c.Value, d.secret)
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
			Tracker:               d.tracker,
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
		// Client partagé (même pool de connexions) mais ventilé par poste
		// de dépense via ForFeature — les métriques distinguent bot,
		// modération, icebreakers et analyse.
		claudeClient := claudeapi.New(cfg.AnthropicAPIKey,
			claudeapi.WithModel(cfg.AnthropicModel),
			claudeapi.WithLogger(log),
			claudeapi.WithUsageFunc(d.aiUsage),
		)
		wsDeps.Bot = ws.NewBotManager(ws.BotManagerConfig{
			Matcher:       wsDeps.Matcher,
			Hub:           wsDeps.Hub,
			Claude:        claudeClient.ForFeature("bot"),
			Quota:         wsDeps.Quota,
			Log:           log,
			TriggerDelay:  time.Duration(cfg.BotTriggerDelaySec) * time.Second,
			MaxConcurrent: cfg.BotMaxConcurrent,
			Tracker:       d.tracker,
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
		toxClassifier := moderation.NewClassifier(claudeClient.ForFeature("moderation"), log)
		// Étage supervisé local (sidecar Detoxify) : les messages
		// manifestement sains ne remontent pas à Claude. Le compteur
		// d'étages rend le taux d'économie lisible dans Grafana.
		toxClassifier.Observe = d.met.RegisterLabeledCounter(
			"jolyne_moderation_stage_total",
			"Messages de chat par étage décideur de la cascade de modération.",
			"stage",
		)
		if cfg.ToxicityScorerURL != "" {
			toxClassifier.Scorer = moderation.NewLocalScorer(cfg.ToxicityScorerURL)
			log.Info("toxicity local scorer ready", "url", cfg.ToxicityScorerURL)
		}
		wsDeps.Toxicity = &ws.ToxicityGuard{
			Classifier: toxClassifier,
			RDB:        rdb,
			Bans:       d.bans,
			Tracker:    d.tracker,
			Log:        log,
		}
		// Amorces de conversation générées par Claude, cachées dans Redis
		// par langue pratiquée (TTL 6 h) — servies au match humain-humain.
		wsDeps.Icebreakers = &ws.IcebreakerService{
			Claude: claudeClient.ForFeature("icebreaker"),
			RDB:    rdb,
			Log:    log,
		}
		// Analyse IA de fin de conversation : vocabulaire → carnet,
		// fautes corrigées → items de révision (leçon du jour), niveau
		// CECRL → profil user (EWMA). Réutilise le même client Claude.
		wsDeps.Analyzer = &ws.SessionAnalyzer{
			Claude: claudeClient.ForFeature("analyzer"),
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
		// Batch API pour l'analyse (−50 % sur les tokens) : le matériau
		// pédagogique arrive quelques minutes plus tard — invisible, il
		// n'est pas affiché à chaud. File en mémoire uniquement (la
		// transcription n'est jamais persistée — règle d'or #1).
		if cfg.AnalyzerBatch {
			analysisBatcher = &ws.AnalysisBatcher{
				Claude: claudeClient.ForFeature("analyzer"),
				Log:    log,
			}
			analysisBatcher.Start(ctx)
			wsDeps.Analyzer.Batcher = analysisBatcher
			log.Info("analyzer batch mode ready")
		}
		log.Info("bot peer ready",
			"model", cfg.AnthropicModel,
			"trigger_delay_sec", cfg.BotTriggerDelaySec,
			"max_concurrent", cfg.BotMaxConcurrent,
		)
	} else {
		log.Info("bot peer disabled — ANTHROPIC_API_KEY missing")
	}

	svc.wsHandler = ws.NewHandler(*wsDeps)
	log.Info("profile endpoints ready", "cloudinary", cld.IsConfigured())

	// Friends : amitiés mutuelles + chats persistés. On réutilise le
	// même Friends.Store que wsDeps pour cohérence (deux instances
	// fonctionneraient mais autant éviter).
	svc.friends = &friends.Handlers{
		Store:                wsDeps.Friends,
		Profile:              profileStore,
		Reports:              d.reports,
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
		Tracker: d.tracker,
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
		Tracker:   d.tracker,
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

	return resolveUserID, analysisBatcher
}
