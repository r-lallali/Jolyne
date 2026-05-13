package quota

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// FreeNextDaily est le quota gratuit (cf. PLAN.md §4 Phase 3 et CLAUDE.md).
// Free = 10 next/jour. Premium = illimité.
const FreeNextDaily = 10

var ErrQuotaExceeded = errors.New("quota dépassé")

// Engine compte les actions limitées (next, traduction) dans Redis avec un
// TTL aligné sur minuit local. Une clé par fingerprint (anonyme) ou userId
// (compte authentifié) — voir PLAN.md §3 "Convention de nommage des queues".
type Engine struct {
	rdb *redis.Client
	loc *time.Location
}

func NewEngine(rdb *redis.Client, loc *time.Location) *Engine {
	if loc == nil {
		loc = time.Local
	}
	return &Engine{rdb: rdb, loc: loc}
}

// CheckAndIncrementNext incrémente le compteur "next" de l'identité passée.
// Renvoie ErrQuotaExceeded si la limite Free est atteinte (pour Premium,
// passer max=0 pour désactiver le plafond).
//
// La clé Redis suit la convention `quota:next:{id}` avec un TTL aligné
// minuit local. Le premier INCR de la journée pose le TTL.
func (e *Engine) CheckAndIncrementNext(ctx context.Context, id string, max int64) (used int64, err error) {
	if id == "" {
		return 0, fmt.Errorf("quota: id vide")
	}
	key := "quota:next:" + id
	pipe := e.rdb.Pipeline()
	incr := pipe.Incr(ctx, key)
	pipe.ExpireNX(ctx, key, e.untilMidnight())
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, fmt.Errorf("quota incr: %w", err)
	}
	used = incr.Val()
	if max > 0 && used > max {
		return used, ErrQuotaExceeded
	}
	return used, nil
}

func (e *Engine) untilMidnight() time.Duration {
	now := time.Now().In(e.loc)
	tomorrow := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, e.loc)
	return time.Until(tomorrow)
}
