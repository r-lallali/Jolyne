package matcher

import (
	"context"
	"errors"
	"fmt"

	"github.com/redis/go-redis/v9"
)

// Outcome décrit le résultat d'un TryMatch.
type Outcome struct {
	Matched bool
	PeerID  string // sessionID du peer matché — non vide ssi Matched
}

// Matcher tente de mettre en relation deux clients selon leurs préférences
// linguistiques. Stateless : tout l'état vit dans Redis. Voir CLAUDE.md
// §Backend Go > Redis pour les invariants.
type Matcher struct {
	rdb *redis.Client
}

func New(rdb *redis.Client) *Matcher {
	return &Matcher{rdb: rdb}
}

// TryMatch tente d'extraire un peer compatible. Si aucun n'est disponible,
// inscrit le client dans sa propre queue. `avoidPeerID` (chaîne vide si pas
// d'éviction) permet d'éviter immédiatement un peer qu'on vient de quitter.
//
// L'appelant DOIT enregistrer un defer pour Cancel(...) sur le sessionID
// au cas où la connexion serait fermée avant qu'un peer ne le récupère —
// sinon le slot devient un fantôme (CLAUDE.md règle d'or #4).
func (m *Matcher) TryMatch(ctx context.Context, speaks, wants LangCode, sessionID, avoidPeerID string) (Outcome, error) {
	if err := ValidatePair(speaks, wants); err != nil {
		return Outcome{}, err
	}
	if sessionID == "" {
		return Outcome{}, fmt.Errorf("matcher: sessionID vide")
	}
	res, err := matchScript.Run(
		ctx, m.rdb,
		[]string{queueTarget(speaks, wants), queueOwn(speaks, wants)},
		sessionID, avoidPeerID,
	).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return Outcome{}, fmt.Errorf("matcher: lua: %w", err)
	}
	peerID, _ := res.(string)
	if peerID == "" {
		return Outcome{Matched: false}, nil
	}
	return Outcome{Matched: true, PeerID: peerID}, nil
}

// Cancel retire un sessionID de sa queue. Idempotent : 0 si déjà absent.
// À appeler en defer côté handler WS quand la connexion se ferme avant match.
func (m *Matcher) Cancel(ctx context.Context, speaks, wants LangCode, sessionID string) error {
	if err := ValidatePair(speaks, wants); err != nil {
		return err
	}
	if err := m.rdb.LRem(ctx, queueOwn(speaks, wants), 0, sessionID).Err(); err != nil {
		return fmt.Errorf("matcher: lrem: %w", err)
	}
	return nil
}
