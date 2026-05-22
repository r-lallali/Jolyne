// Package push : Web Push notifications. Stocke les abonnements
// PushManager dans Postgres et expose un Send() best-effort vers tous
// les appareils d'un user. Conformément à CLAUDE.md règle d'or #1 :
// on n'envoie JAMAIS le contenu d'un message dans le payload, seulement
// un preview tronqué + le nom du peer.
package push

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("push: subscription not found")

// Subscription : payload PushManager.subscribe() côté navigateur. Le keys
// (p256dh, auth) sont utilisés pour chiffrer le payload de notification.
type Subscription struct {
	Endpoint  string
	P256dh    string
	Auth      string
	UserAgent string
}

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// Upsert : enregistre une subscription. Si l'endpoint existe déjà
// (refresh navigateur, re-subscribe), on met à jour les clés et le
// user_id (un même appareil peut se ré-attribuer après logout/login).
func (s *Store) Upsert(ctx context.Context, userID int64, sub Subscription) error {
	const q = `
		INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (endpoint) DO UPDATE
		    SET user_id    = EXCLUDED.user_id,
		        p256dh     = EXCLUDED.p256dh,
		        auth       = EXCLUDED.auth,
		        user_agent = EXCLUDED.user_agent`
	_, err := s.pool.Exec(ctx, q, userID, sub.Endpoint, sub.P256dh, sub.Auth, sub.UserAgent)
	if err != nil {
		return fmt.Errorf("push: upsert: %w", err)
	}
	return nil
}

// DeleteByEndpoint : retrait explicite (unsubscribe côté front) ou nettoyage
// après un 410 Gone retourné par le push service.
func (s *Store) DeleteByEndpoint(ctx context.Context, endpoint string) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM push_subscriptions WHERE endpoint = $1`, endpoint,
	)
	if err != nil {
		return fmt.Errorf("push: delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListForUser : tous les appareils abonnés d'un user. Une seule requête
// suffit — on n'attend pas des centaines d'entrées par user.
func (s *Store) ListForUser(ctx context.Context, userID int64) ([]Subscription, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT endpoint, p256dh, auth, user_agent
		 FROM push_subscriptions WHERE user_id = $1`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("push: list: %w", err)
	}
	defer rows.Close()
	out := []Subscription{}
	for rows.Next() {
		var sub Subscription
		if err := rows.Scan(&sub.Endpoint, &sub.P256dh, &sub.Auth, &sub.UserAgent); err != nil {
			return nil, fmt.Errorf("push: scan: %w", err)
		}
		out = append(out, sub)
	}
	return out, rows.Err()
}

// devnull au cas où on a besoin de matcher un signature qui retourne pgx.Rows.
var _ = pgx.ErrNoRows
