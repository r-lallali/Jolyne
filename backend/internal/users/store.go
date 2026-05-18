// Package users : modèle utilisateur + opérations DB (compte créé via
// magic link, pas de password). Voir PLAN.md §4 Phase 3.
package users

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("users: not found")

type User struct {
	ID         int64
	Email      string
	CreatedAt  time.Time
	LastSeenAt *time.Time
}

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// UpsertByEmail : si l'email existe déjà, renvoie le user. Sinon le crée.
// Normalise l'email en minuscules pour l'unicité.
func (s *Store) UpsertByEmail(ctx context.Context, email string) (User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return User{}, fmt.Errorf("users: email vide")
	}
	const q = `
		INSERT INTO users (email)
		VALUES ($1)
		ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
		RETURNING id, email, created_at, last_seen_at`
	var u User
	if err := s.pool.QueryRow(ctx, q, email).Scan(
		&u.ID, &u.Email, &u.CreatedAt, &u.LastSeenAt,
	); err != nil {
		return User{}, fmt.Errorf("users: upsert: %w", err)
	}
	return u, nil
}

func (s *Store) GetByID(ctx context.Context, id int64) (User, error) {
	const q = `SELECT id, email, created_at, last_seen_at FROM users WHERE id = $1`
	var u User
	if err := s.pool.QueryRow(ctx, q, id).Scan(
		&u.ID, &u.Email, &u.CreatedAt, &u.LastSeenAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return User{}, ErrNotFound
		}
		return User{}, fmt.Errorf("users: get by id: %w", err)
	}
	return u, nil
}

// TouchLastSeen : best-effort, n'échoue jamais bruyamment côté caller.
func (s *Store) TouchLastSeen(ctx context.Context, id int64) error {
	_, err := s.pool.Exec(ctx, `UPDATE users SET last_seen_at = now() WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("users: touch last seen: %w", err)
	}
	return nil
}
