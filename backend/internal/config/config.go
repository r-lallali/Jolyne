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

	RedisAddr     string
	RedisPassword string
	RedisDB       int

	PostgresDSN     string
	PostgresMigrate bool

	// Clé base64 de 32 octets pour chiffrer les messages capturés lors
	// d'un signalement. Génération : `openssl rand -base64 32`.
	ReportEncryptionKey string

	// Back-office admin (Phase 2). Voir CLAUDE.md §"Back-office /admin".
	AdminUsersRaw     string
	AdminIPAllowlist  string
	AdminSessionKey   string // base64, ≥ 32 octets
	AdminCookieDomain string // ex: "ralys.ovh"
	AdminCORSOrigin   string // ex: "https://jolyne.ralys.ovh"

	// CORS origin du frontend public (chat). Utilisé par /api/translate
	// et /api/grammar. Vide en dev → tout passe.
	PublicCORSOrigin string

	// LibreTranslate self-hosted (cf. PLAN.md §4 Phase 2). Vide → endpoint
	// /api/translate désactivé.
	LibreTranslateURL    string
	LibreTranslateAPIKey string

	// LanguageTool self-hosted. Vide → endpoint /api/grammar désactivé.
	LanguageToolURL string

	ShutdownGrace time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		Env:             getEnv("JOLYNE_ENV", "dev"),
		Port:            getEnvInt("JOLYNE_PORT", 8080),
		RedisAddr:       getEnv("REDIS_ADDR", "127.0.0.1:6379"),
		RedisPassword:   os.Getenv("REDIS_PASSWORD"),
		RedisDB:         getEnvInt("REDIS_DB", 0),
		PostgresDSN:         os.Getenv("POSTGRES_DSN"),
		PostgresMigrate:     getEnvBool("POSTGRES_AUTO_MIGRATE", false),
		ReportEncryptionKey: os.Getenv("REPORT_ENCRYPTION_KEY"),
		AdminUsersRaw:       os.Getenv("ADMIN_USERS"),
		AdminIPAllowlist:    os.Getenv("ADMIN_IP_ALLOWLIST"),
		AdminSessionKey:     os.Getenv("ADMIN_SESSION_SECRET"),
		AdminCookieDomain:    os.Getenv("ADMIN_COOKIE_DOMAIN"),
		AdminCORSOrigin:      os.Getenv("ADMIN_CORS_ORIGIN"),
		PublicCORSOrigin:     os.Getenv("PUBLIC_CORS_ORIGIN"),
		LibreTranslateURL:    os.Getenv("LIBRETRANSLATE_URL"),
		LibreTranslateAPIKey: os.Getenv("LIBRETRANSLATE_API_KEY"),
		LanguageToolURL:      os.Getenv("LANGUAGETOOL_URL"),
		ShutdownGrace:        getEnvDuration("SHUTDOWN_GRACE", 10*time.Second),
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
