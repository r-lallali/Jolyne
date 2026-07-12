package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/admin"
	"github.com/ralys/jolyne/backend/internal/bans"
	"github.com/ralys/jolyne/backend/internal/config"
	"github.com/ralys/jolyne/backend/internal/crypto"
)

// wireAdmin construit le back-office /api/admin/*. Désactivé (handlers nil)
// si Postgres / ADMIN_USERS / ADMIN_SESSION_SECRET ne sont pas tous là.
// Renvoie aussi l'allowlist IP (réutilisée pour /metrics) et le set des
// emails admin (séparation stricte admin/compte user).
func wireAdmin(cfg config.Config, pg *pgxpool.Pool, banSvc *bans.Service, log *slog.Logger, startedAt time.Time) (*admin.Handlers, []*net.IPNet, map[string]struct{}, error) {
	if pg == nil || cfg.AdminUsersRaw == "" || cfg.AdminSessionKey == "" {
		log.Info("admin back-office disabled — Postgres / ADMIN_USERS / ADMIN_SESSION_SECRET manquants")
		return nil, nil, nil, nil
	}
	adminUsers, err := admin.ParseUsers(cfg.AdminUsersRaw)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("admin users: %w", err)
	}
	// Set des emails admin (déjà en minuscules) — sert à empêcher qu'une
	// même adresse soit à la fois admin et compte user.
	adminEmails := make(map[string]struct{}, len(adminUsers))
	for _, e := range admin.LoadedEmails(adminUsers) {
		adminEmails[e] = struct{}{}
	}
	allowlist, err := admin.ParseIPAllowlist(cfg.AdminIPAllowlist)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("admin allowlist: %w", err)
	}
	secret, err := base64.StdEncoding.DecodeString(cfg.AdminSessionKey)
	if err != nil || len(secret) < 32 {
		return nil, nil, nil, fmt.Errorf("admin session secret: must be base64 ≥32 bytes")
	}
	// Reports.box est nil-safe — l'admin ne déchiffre que si la clé est
	// présente. On réutilise la même box que reports.
	var box *crypto.Box
	if cfg.ReportEncryptionKey != "" {
		box, _ = crypto.NewBox(cfg.ReportEncryptionKey)
	}
	h := &admin.Handlers{
		Cfg: admin.Config{
			Users:               adminUsers,
			IPAllowlist:         allowlist,
			SessionSecret:       secret,
			CookieDomain:        cfg.AdminCookieDomain,
			CookieSecure:        cfg.IsProd(),
			CORSOrigin:          cfg.AdminCORSOrigin,
			PremiumMonthlyCents: parseEnvCents("PREMIUM_MONTHLY_CENTS"),
		},
		Store:     admin.NewStore(pg, box),
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
		"ip_allowlist", len(allowlist),
		"cookie_domain", cfg.AdminCookieDomain)
	return h, allowlist, adminEmails, nil
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
