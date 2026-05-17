// Package blocking gère la "block list" personnelle : un user qui signale
// un peer ne doit plus jamais le re-matcher (jusqu'à expiration TTL).
//
// Stockage Redis : set `blocked:{ownerFp}` contenant les fingerprints
// bloqués par owner. TTL refresh à chaque ajout.
package blocking

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// TTL : 30 jours. Suffisant pour gérer une période de fréquentation
// récurrente sans encombrer Redis indéfiniment.
const TTL = 30 * 24 * time.Hour

type Service struct {
	rdb *redis.Client
}

func New(rdb *redis.Client) *Service { return &Service{rdb: rdb} }

func key(fp string) string { return "blocked:" + fp }

// Add ajoute `blockedFp` à la block list de `ownerFp`. Refresh le TTL.
// Silencieux sur entrées vides.
func (s *Service) Add(ctx context.Context, ownerFp, blockedFp string) error {
	if ownerFp == "" || blockedFp == "" || ownerFp == blockedFp {
		return nil
	}
	pipe := s.rdb.Pipeline()
	pipe.SAdd(ctx, key(ownerFp), blockedFp)
	pipe.Expire(ctx, key(ownerFp), TTL)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("blocking add: %w", err)
	}
	return nil
}

// IsBlocked indique si `ownerFp` a bloqué `otherFp`. False si l'un est vide.
func (s *Service) IsBlocked(ctx context.Context, ownerFp, otherFp string) (bool, error) {
	if ownerFp == "" || otherFp == "" {
		return false, nil
	}
	return s.rdb.SIsMember(ctx, key(ownerFp), otherFp).Result()
}
