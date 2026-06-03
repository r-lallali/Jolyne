package quota

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// Kind identifie la ressource limitée. Une clé Redis par (kind, identité).
type Kind string

const (
	KindNext      Kind = "next"      // nouveaux partenaires (swipe)
	KindTranslate Kind = "translate" // traductions via /api/translate
	KindBot       Kind = "bot"       // messages au prof IA (bot Claude)
)

// Plafonds gratuits quotidiens (Free). Premium = illimité (passer max=0).
// Untyped pour s'utiliser indifféremment en int ou int64.
const (
	FreeNextDaily      = 10 // nouveaux partenaires / jour
	FreeTranslateDaily = 10 // traductions / jour
	FreeBotDaily       = 50 // messages au prof IA / jour
)

var ErrQuotaExceeded = errors.New("quota dépassé")

// Engine compte les actions limitées dans Redis avec un TTL aligné sur
// minuit local. Une clé par identité : userId (compte authentifié) ou
// fingerprint (anonyme) — voir la convention de nommage des quotas.
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

// CheckAndIncrement incrémente le compteur (kind, id) et renvoie le total du
// jour. Renvoie ErrQuotaExceeded si la limite Free est dépassée (max>0). Pour
// Premium, passer max=0 pour désactiver le plafond.
//
// La clé suit `quota:{kind}:{id}` avec un TTL aligné minuit local — le premier
// INCR de la journée pose le TTL (ExpireNX ne le prolonge jamais ensuite).
func (e *Engine) CheckAndIncrement(ctx context.Context, kind Kind, id string, max int64) (used int64, err error) {
	if id == "" {
		return 0, fmt.Errorf("quota: id vide")
	}
	key := e.key(kind, id)
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

// CheckAndIncrementNext : wrapper rétro-compatible pour le quota "next".
func (e *Engine) CheckAndIncrementNext(ctx context.Context, id string, max int64) (int64, error) {
	return e.CheckAndIncrement(ctx, KindNext, id, max)
}

// Used renvoie le compteur courant pour (kind, id) sans l'incrémenter. 0 si la
// clé n'existe pas (jour neuf). Sert au pré-check (bloquer avant de mobiliser
// un peer) et à un éventuel endpoint d'état des quotas.
func (e *Engine) Used(ctx context.Context, kind Kind, id string) (int64, error) {
	if id == "" {
		return 0, fmt.Errorf("quota: id vide")
	}
	v, err := e.rdb.Get(ctx, e.key(kind, id)).Int64()
	if errors.Is(err, redis.Nil) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("quota get: %w", err)
	}
	return v, nil
}

func (e *Engine) key(kind Kind, id string) string {
	return "quota:" + string(kind) + ":" + id
}

// Identity construit la clé de quota stable d'un client. Espaces de noms
// disjoints "u:" (compte) et "fp:" (fingerprint) → aucune collision possible,
// même si un fingerprint imitait un userID. Renvoie "" si aucune identité
// (anonyme sans fingerprint) : les callers traitent ce cas en fail-open.
// Garantit qu'un user gardant son compte ne regagne pas ses quotas en changeant
// d'appareil, et qu'un anonyme ne les regagne pas en se déconnectant.
func Identity(userID int64, fingerprint string) string {
	if userID > 0 {
		return "u:" + strconv.FormatInt(userID, 10)
	}
	if fingerprint == "" {
		return ""
	}
	return "fp:" + fingerprint
}

func (e *Engine) untilMidnight() time.Duration {
	now := time.Now().In(e.loc)
	tomorrow := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, e.loc)
	return time.Until(tomorrow)
}
