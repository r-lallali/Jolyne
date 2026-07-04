package matcher

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// Boosts de score (en secondes) appliqués à l'arrivée d'un peer pour prioriser
// les files. Un boost plus élevé = arrivée effective plus tôt = matché en
// premier. Volontairement modestes : l'attente réelle (minutes) domine, donc
// aucun peer ne meurt de faim, mais à instant égal on surface d'abord les
// partenaires plus fiables (authentifiés) et on offre un léger coupe-file aux
// abonnés Premium.
const (
	boostAuthenticated = 20.0 // compte connecté = peer plus responsable/traçable
	boostPremium       = 40.0 // coupe-file Premium (cumulable avec l'auth)
)

// MatchScore calcule le score d'inscription d'un peer dans sa file. Plus il est
// BAS, plus le peer est matché tôt (ZPOPMIN). base = horodatage d'arrivée pour
// garantir un ordre ~FIFO ; on retranche un boost selon la qualité du peer.
func MatchScore(now time.Time, authenticated, premium bool) float64 {
	score := float64(now.Unix())
	if authenticated {
		score -= boostAuthenticated
	}
	if premium {
		score -= boostPremium
	}
	return score
}

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
func (m *Matcher) TryMatch(ctx context.Context, speaks, wants LangCode, sessionID, avoidPeerID string, score float64) (Outcome, error) {
	if err := ValidatePair(speaks, wants); err != nil {
		return Outcome{}, err
	}
	if sessionID == "" {
		return Outcome{}, fmt.Errorf("matcher: sessionID vide")
	}
	res, err := matchScript.Run(
		ctx, m.rdb,
		[]string{queueTarget(speaks, wants), queueOwn(speaks, wants)},
		sessionID, avoidPeerID, score,
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
	if err := m.rdb.ZRem(ctx, queueOwn(speaks, wants), sessionID).Err(); err != nil {
		return fmt.Errorf("matcher: zrem: %w", err)
	}
	return nil
}

// RemoveFromQueue retire un sessionID PRÉCIS d'une queue donnée et
// indique si la session y était (true) ou pas (false). Utilisé par le
// botpeer pour s'assurer qu'il "prend la main" sur un user en attente
// avant de déclencher un match — false = race perdue (le user a été
// matché avec un humain entre-temps), on abort la spawn.
//
// `speaks`/`wants` sont ceux du USER qu'on veut sortir de queue
// (= la queue où il est inscrit côté propre).
func (m *Matcher) RemoveFromQueue(ctx context.Context, speaks, wants LangCode, sessionID string) (bool, error) {
	if err := ValidatePair(speaks, wants); err != nil {
		return false, err
	}
	if sessionID == "" {
		return false, fmt.Errorf("matcher: sessionID vide")
	}
	n, err := m.rdb.ZRem(ctx, queueOwn(speaks, wants), sessionID).Result()
	if err != nil {
		return false, fmt.Errorf("matcher: zrem: %w", err)
	}
	return n > 0, nil
}
