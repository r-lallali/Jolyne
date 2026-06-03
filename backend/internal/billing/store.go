package billing

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// EventStore : implémentation Postgres de EventLog. La table stripe_events
// stocke les IDs d'events déjà traités pour dédupliquer les rejeux Stripe.
type EventStore struct {
	pool *pgxpool.Pool
}

func NewEventStore(pool *pgxpool.Pool) *EventStore { return &EventStore{pool: pool} }

func (s *EventStore) AlreadyProcessed(ctx context.Context, eventID string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM stripe_events WHERE event_id = $1)`, eventID,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("billing: event lookup: %w", err)
	}
	return exists, nil
}

func (s *EventStore) MarkProcessed(ctx context.Context, eventID string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO stripe_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING`, eventID,
	)
	if err != nil {
		return fmt.Errorf("billing: mark event: %w", err)
	}
	return nil
}
