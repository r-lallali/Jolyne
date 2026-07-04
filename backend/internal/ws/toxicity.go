package ws

import (
	"context"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/analytics"
	"github.com/ralys/jolyne/backend/internal/bans"
	"github.com/ralys/jolyne/backend/internal/moderation"
	"github.com/ralys/jolyne/backend/internal/session"
)

// ToxicityGuard surveille la toxicité des messages du chat anonyme via Claude,
// EN DEHORS du chemin critique : le message est déjà relayé quand Inspect
// tourne (goroutine détachée). La blocklist statique reste le filtre instantané
// synchrone ; ce garde attrape ce qu'elle rate (harcèlement contextuel, menaces
// déguisées, toutes langues).
//
// Politique : chaque message jugé toxique (severity ≥ Threshold) déclenche un
// avertissement au fautif et incrémente un compteur de « strikes » glissant par
// fingerprint dans Redis. Au-delà de StrikeLimit, une suspension courte est
// posée (bans par fingerprint + IP) — la connexion courante n'est pas coupée
// (on ne race pas le socket), mais toute reconnexion est refusée.
type ToxicityGuard struct {
	Classifier *moderation.Classifier
	RDB        *redis.Client
	Bans       *bans.Service      // optionnel : suspension auto sur récidive
	Tracker    *analytics.Tracker // optionnel : event moderation_flagged
	Log        *slog.Logger

	// Threshold : sévérité minimale (1-3) considérée comme toxique. 2 par défaut
	// (« clairement toxique ») pour éviter de sanctionner une vulgarité anodine.
	Threshold int
	// StrikeLimit : nombre de messages toxiques dans la fenêtre avant sanction.
	StrikeLimit int
	// Window : fenêtre glissante de comptage des strikes.
	Window time.Duration
	// BanDuration : durée de la suspension posée au dépassement de StrikeLimit.
	BanDuration time.Duration
}

// Enabled : le garde n'agit que si un classifieur Claude actif est branché.
func (g *ToxicityGuard) Enabled() bool {
	return g != nil && g.Classifier.Enabled()
}

func (g *ToxicityGuard) threshold() int {
	if g.Threshold <= 0 {
		return 2
	}
	return g.Threshold
}

func (g *ToxicityGuard) strikeLimit() int {
	if g.StrikeLimit <= 0 {
		return 3
	}
	return g.StrikeLimit
}

func (g *ToxicityGuard) window() time.Duration {
	if g.Window <= 0 {
		return 30 * time.Minute
	}
	return g.Window
}

func (g *ToxicityGuard) banDuration() time.Duration {
	if g.BanDuration <= 0 {
		return time.Hour
	}
	return g.BanDuration
}

// Inspect classe un message et applique la politique. Conçu pour tourner dans
// une goroutine détachée (contexte propre borné) — aucun retour, tout effet
// passe par conn.Send (canal, concurrent-safe) ou les stores.
func (g *ToxicityGuard) Inspect(conn *Conn, sess session.Session, body string) {
	if !g.Enabled() || body == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	v := g.Classifier.Classify(ctx, body)
	if v.Severity < g.threshold() {
		return
	}

	// Avertit le fautif (le front affiche un bandeau). On ne coupe pas la conv
	// sur un seul message — laisse une chance de se corriger.
	conn.Send(ServerFrame{
		Type:    ServerModerationWarning,
		Code:    v.Category,
		Message: "Ton dernier message a été signalé comme inapproprié.",
	})

	if g.Tracker != nil {
		g.Tracker.Emit(analytics.Event{
			Name:      analytics.EventModerationFlagged,
			UserID:    sess.UserID,
			SessionID: sess.ID,
			IPHash:    sess.IPHash,
			Props: map[string]any{
				"category": v.Category,
				"severity": v.Severity,
			},
		})
	}

	strikes := g.recordStrike(ctx, sess.Fingerprint)
	if strikes < int64(g.strikeLimit()) || g.Bans == nil {
		return
	}
	// Récidive : suspension courte multi-axes (fingerprint + IP hashée). La
	// connexion courante continue, mais la reconnexion sera refusée.
	if _, err := g.Bans.IssueBan(ctx, bans.Issue{
		IPHash:      sess.IPHash,
		Fingerprint: sess.Fingerprint,
		Reason:      "toxicité répétée (modération IA)",
		BannedBy:    "ai-moderation",
		Duration:    g.banDuration(),
	}, sess.IPHash); err != nil && g.Log != nil {
		g.Log.Warn("toxicity auto-ban failed", "err", err)
	}
}

// recordStrike incrémente le compteur glissant de strikes du fingerprint et
// renvoie le total courant. TTL posé au premier strike (fenêtre glissante
// simple). Fail-open : 0 si Redis KO (pas de fingerprint = pas de strike).
func (g *ToxicityGuard) recordStrike(ctx context.Context, fingerprint string) int64 {
	if fingerprint == "" || g.RDB == nil {
		return 0
	}
	key := "tox:" + fingerprint
	pipe := g.RDB.Pipeline()
	incr := pipe.Incr(ctx, key)
	pipe.ExpireNX(ctx, key, g.window())
	if _, err := pipe.Exec(ctx); err != nil {
		if g.Log != nil {
			g.Log.Warn("toxicity strike incr failed", "err", err)
		}
		return 0
	}
	return incr.Val()
}
