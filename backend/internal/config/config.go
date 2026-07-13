package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Env  string
	Port int

	// TrustedProxies : nombre de reverse-proxies de confiance en frontal (Traefik
	// = 1). Sert à extraire l'IP cliente réelle depuis X-Forwarded-For sans se
	// faire usurper par un client qui forge l'en-tête. 0 = exposition directe,
	// on ignore X-Forwarded-For (voir netx.ClientIP).
	TrustedProxies int

	RedisAddr     string
	RedisPassword string
	RedisDB       int

	PostgresDSN     string
	PostgresMigrate bool

	// Clé base64 de 32 octets pour chiffrer les messages capturés lors
	// d'un signalement. Génération : `openssl rand -base64 32`.
	ReportEncryptionKey string

	// Back-office admin. Non configuré → /api/admin/* reste en 404 délibéré
	// (on ne révèle pas l'existence du back-office, jamais de 401).
	AdminUsersRaw     string
	AdminIPAllowlist  string
	AdminSessionKey   string // base64, ≥ 32 octets
	AdminCookieDomain string // ex: "ralys.ovh"
	AdminCORSOrigin   string // ex: "https://jolyne.ralys.ovh"

	// CORS origin du frontend public (chat). Utilisé par /api/translate
	// et /api/grammar. Vide en dev → tout passe.
	PublicCORSOrigin string

	// LibreTranslate self-hosted. Vide → endpoint /api/translate désactivé.
	LibreTranslateURL    string
	LibreTranslateAPIKey string

	// LanguageTool self-hosted. Vide → endpoint /api/grammar désactivé.
	LanguageToolURL string

	// Auth utilisateur (email + mot de passe ; vérification d'adresse et
	// reset par e-mail via Mailjet). Tout en une fois — si l'un manque,
	// l'auth est désactivée (les endpoints /api/auth/* renvoient 503).
	UserSessionKey   string // base64, ≥ 32 octets
	UserCookieDomain string // ex: "ralys.ovh" pour partager entre subdomains
	PublicAppURL     string // ex: https://jolyne.ralys.ovh — racine front

	// Mailjet SMTP (in-v3.mailjet.com:587 par défaut).
	MailjetSMTPHost string
	MailjetSMTPPort int
	MailjetAPIKey   string // username SMTP
	MailjetSecret   string // password SMTP
	MailjetFrom     string // ex: "Jolyne <hello@jolyne.ralys.ovh>" (sender vérifié)

	// Cloudinary (photos de profil). Vide → upload désactivé (handler 503).
	CloudinaryCloudName string
	CloudinaryAPIKey    string
	CloudinaryAPISecret string
	CloudinaryFolder    string // ex: "jolyne/avatars"

	// Web Push (VAPID). Tout vide → endpoints /api/notifications/* renvoient
	// 503 et le sender no-op. VAPIDSubject est requis par la spec RFC 8292,
	// typiquement "mailto:hello@jolyne.ralys.ovh".
	VAPIDPublicKey  string
	VAPIDPrivateKey string
	VAPIDSubject    string

	// Bot prof IA (Anthropic Claude). ANTHROPIC_API_KEY vide → bot
	// désactivé, comportement chat anonyme identique à avant. Default
	// model "claude-haiku-4-5-20251001" (ID canonique avec date — l'alias
	// sans date n'est pas garanti et un modèle inconnu fait échouer TOUS les
	// appels en 404, donc bot muet / réponses de repli).
	AnthropicAPIKey    string
	AnthropicModel     string
	BotMaxConcurrent   int
	BotTriggerDelaySec int

	// Scorer de toxicité local (sidecar Detoxify) : 1er étage de la cascade
	// de modération. Vide → cascade réduite à pré-filtre + Claude.
	ToxicityScorerURL string

	// AnalyzerBatch : analyse post-conversation via la Batch API Anthropic
	// (−50 % sur les tokens, résultats différés de quelques minutes — le
	// matériau pédagogique n'est pas affiché à chaud, le délai est invisible).
	// false → appel direct synchrone comme avant.
	AnalyzerBatch bool

	// MatchLevelAware : préférence de niveau CECRL au matching (voir
	// matcher.Matcher.LevelAware). Off par défaut — à activer une fois les
	// estimations de niveau suffisamment denses pour ne pas biaiser les files.
	MatchLevelAware bool

	// Stripe (abonnement Premium). Billing actif seulement si SecretKey +
	// PriceID présents (sinon /api/billing/* renvoie 503). WebhookSecret
	// requis pour vérifier la signature des webhooks. Success/CancelURL
	// dérivées de PublicAppURL si vides.
	StripeSecretKey     string
	StripeWebhookSecret string
	StripePriceID       string // price_... de l'abonnement Premium
	StripeSuccessURL    string
	StripeCancelURL     string

	// Sentry (observabilité erreurs). Vide → aucun forwarding, comme avant.
	// Seule la taxonomie des logs Error part vers Sentry — jamais de contenu
	// de message ni de PII (règles d'or #1 et #6).
	SentryDSN string

	ShutdownGrace time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		Env:                  getEnv("JOLYNE_ENV", "dev"),
		Port:                 getEnvInt("JOLYNE_PORT", 8080),
		TrustedProxies:       getEnvInt("TRUSTED_PROXY_COUNT", 1),
		RedisAddr:            getEnv("REDIS_ADDR", "127.0.0.1:6379"),
		RedisPassword:        os.Getenv("REDIS_PASSWORD"),
		RedisDB:              getEnvInt("REDIS_DB", 0),
		PostgresDSN:          os.Getenv("POSTGRES_DSN"),
		PostgresMigrate:      getEnvBool("POSTGRES_AUTO_MIGRATE", false),
		ReportEncryptionKey:  os.Getenv("REPORT_ENCRYPTION_KEY"),
		AdminUsersRaw:        os.Getenv("ADMIN_USERS"),
		AdminIPAllowlist:     os.Getenv("ADMIN_IP_ALLOWLIST"),
		AdminSessionKey:      os.Getenv("ADMIN_SESSION_SECRET"),
		AdminCookieDomain:    os.Getenv("ADMIN_COOKIE_DOMAIN"),
		AdminCORSOrigin:      os.Getenv("ADMIN_CORS_ORIGIN"),
		PublicCORSOrigin:     os.Getenv("PUBLIC_CORS_ORIGIN"),
		LibreTranslateURL:    os.Getenv("LIBRETRANSLATE_URL"),
		LibreTranslateAPIKey: os.Getenv("LIBRETRANSLATE_API_KEY"),
		LanguageToolURL:      os.Getenv("LANGUAGETOOL_URL"),
		UserSessionKey:       os.Getenv("USER_SESSION_SECRET"),
		UserCookieDomain:     os.Getenv("USER_COOKIE_DOMAIN"),
		PublicAppURL:         os.Getenv("PUBLIC_APP_URL"),
		MailjetSMTPHost:      getEnv("MAILJET_SMTP_HOST", "in-v3.mailjet.com"),
		MailjetSMTPPort:      getEnvInt("MAILJET_SMTP_PORT", 587),
		MailjetAPIKey:        os.Getenv("MAILJET_API_KEY"),
		MailjetSecret:        os.Getenv("MAILJET_SECRET_KEY"),
		MailjetFrom:          os.Getenv("MAILJET_FROM"),
		CloudinaryCloudName:  os.Getenv("CLOUDINARY_CLOUD_NAME"),
		CloudinaryAPIKey:     os.Getenv("CLOUDINARY_API_KEY"),
		CloudinaryAPISecret:  os.Getenv("CLOUDINARY_API_SECRET"),
		CloudinaryFolder:     getEnv("CLOUDINARY_FOLDER", "jolyne/avatars"),
		VAPIDPublicKey:       os.Getenv("VAPID_PUBLIC_KEY"),
		VAPIDPrivateKey:      os.Getenv("VAPID_PRIVATE_KEY"),
		VAPIDSubject:         os.Getenv("VAPID_SUBJECT"),
		AnthropicAPIKey:      os.Getenv("ANTHROPIC_API_KEY"),
		AnthropicModel:       getEnv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001"),
		BotMaxConcurrent:     getEnvInt("BOT_MAX_CONCURRENT", 20),
		BotTriggerDelaySec:   getEnvInt("BOT_TRIGGER_DELAY_SEC", 10),
		ToxicityScorerURL:    os.Getenv("TOXICITY_SCORER_URL"),
		AnalyzerBatch:        getEnvBool("ANALYZER_BATCH", true),
		MatchLevelAware:      getEnvBool("MATCH_LEVEL_AWARE", false),
		StripeSecretKey:      os.Getenv("STRIPE_SECRET_KEY"),
		StripeWebhookSecret:  os.Getenv("STRIPE_WEBHOOK_SECRET"),
		StripePriceID:        os.Getenv("STRIPE_PRICE_ID"),
		StripeSuccessURL:     os.Getenv("STRIPE_SUCCESS_URL"),
		StripeCancelURL:      os.Getenv("STRIPE_CANCEL_URL"),
		SentryDSN:            os.Getenv("SENTRY_DSN"),
		// 30 s : le shutdown draine le batcher d'analyses (appels IA directs)
		// après l'arrêt HTTP — 10 s ne suffisaient qu'à l'arrêt HTTP seul.
		ShutdownGrace: getEnvDuration("SHUTDOWN_GRACE", 30*time.Second),
	}
	if err := cfg.validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c Config) IsProd() bool { return c.Env == "prod" }

func (c Config) validate() error {
	if c.Port < 1 || c.Port > 65535 {
		return fmt.Errorf("port invalide: %d", c.Port)
	}
	if c.RedisAddr == "" {
		return fmt.Errorf("REDIS_ADDR requis")
	}
	return nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return fallback
	}
	return d
}

func getEnvBool(key string, fallback bool) bool {
	v := os.Getenv(key)
	switch v {
	case "true", "1", "yes", "on":
		return true
	case "false", "0", "no", "off":
		return false
	default:
		return fallback
	}
}
