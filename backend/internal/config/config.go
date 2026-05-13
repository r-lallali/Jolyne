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

	ShutdownGrace time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		Env:           getEnv("JOLYNE_ENV", "dev"),
		Port:          getEnvInt("JOLYNE_PORT", 8080),
		RedisAddr:     getEnv("REDIS_ADDR", "127.0.0.1:6379"),
		RedisPassword: os.Getenv("REDIS_PASSWORD"),
		RedisDB:       getEnvInt("REDIS_DB", 0),
		ShutdownGrace: getEnvDuration("SHUTDOWN_GRACE", 10*time.Second),
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
