// Package profile : données de profil utilisateur (display_name, bio,
// birthdate) + photos hébergées sur Cloudinary (jusqu'à 6, position 1
// = principale visible dans le chat).
package profile

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound = errors.New("profile: not found")
)

// Profile + photos. birthdate optionnel (jamais affiché brut côté front,
// uniquement l'âge calculé).
type Profile struct {
	UserID      int64
	DisplayName string
	Bio         string
	Birthdate   *time.Time
	UpdatedAt   time.Time
}

type Photo struct {
	ID       int64
	UserID   int64
	Position int
	PublicID string
}

// Limites de contenu — alignées sur ce que peut afficher la sidebar Hinge.
const (
	DisplayNameMax = 40
	BioMax         = 280
	MaxPhotos      = 6
)

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// Get : renvoie le profil OU une Profile vide (UserID=id) si pas encore
// créé. Pas d'erreur "not found" ici — un user fraîchement créé a un
// profile vide implicite.
func (s *Store) Get(ctx context.Context, userID int64) (Profile, error) {
	const q = `
		SELECT user_id, display_name, bio, birthdate, updated_at
		FROM user_profiles WHERE user_id = $1`
	var p Profile
	err := s.pool.QueryRow(ctx, q, userID).Scan(
		&p.UserID, &p.DisplayName, &p.Bio, &p.Birthdate, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Profile{UserID: userID}, nil
		}
		return Profile{}, fmt.Errorf("profile: get: %w", err)
	}
	return p, nil
}

// Upsert : INSERT ou UPDATE selon présence. Trim + truncate sur les
// champs texte (la validation finale est dans le handler).
func (s *Store) Upsert(ctx context.Context, p Profile) (Profile, error) {
	p.DisplayName = truncate(strings.TrimSpace(p.DisplayName), DisplayNameMax)
	p.Bio = truncate(strings.TrimSpace(p.Bio), BioMax)
	const q = `
		INSERT INTO user_profiles (user_id, display_name, bio, birthdate, updated_at)
		VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (user_id) DO UPDATE SET
			display_name = EXCLUDED.display_name,
			bio          = EXCLUDED.bio,
			birthdate    = EXCLUDED.birthdate,
			updated_at   = now()
		RETURNING user_id, display_name, bio, birthdate, updated_at`
	var out Profile
	err := s.pool.QueryRow(ctx, q,
		p.UserID, p.DisplayName, p.Bio, p.Birthdate,
	).Scan(&out.UserID, &out.DisplayName, &out.Bio, &out.Birthdate, &out.UpdatedAt)
	if err != nil {
		return Profile{}, fmt.Errorf("profile: upsert: %w", err)
	}
	return out, nil
}

// ListPhotos : 1..6 ordonnées par position.
func (s *Store) ListPhotos(ctx context.Context, userID int64) ([]Photo, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, user_id, position, public_id FROM user_photos WHERE user_id = $1 ORDER BY position`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("profile: list photos: %w", err)
	}
	defer rows.Close()
	out := []Photo{}
	for rows.Next() {
		var p Photo
		if err := rows.Scan(&p.ID, &p.UserID, &p.Position, &p.PublicID); err != nil {
			return nil, fmt.Errorf("profile: scan photo: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// SetPhoto : UPSERT position N pour un user. Position doit être 1..6.
func (s *Store) SetPhoto(ctx context.Context, userID int64, position int, publicID string) (Photo, error) {
	if position < 1 || position > MaxPhotos {
		return Photo{}, fmt.Errorf("profile: position invalide (1..%d)", MaxPhotos)
	}
	publicID = strings.TrimSpace(publicID)
	if publicID == "" {
		return Photo{}, fmt.Errorf("profile: public_id vide")
	}
	const q = `
		INSERT INTO user_photos (user_id, position, public_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, position) DO UPDATE SET public_id = EXCLUDED.public_id
		RETURNING id, user_id, position, public_id`
	var p Photo
	err := s.pool.QueryRow(ctx, q, userID, position, publicID).Scan(
		&p.ID, &p.UserID, &p.Position, &p.PublicID,
	)
	if err != nil {
		return Photo{}, fmt.Errorf("profile: set photo: %w", err)
	}
	return p, nil
}

// DeletePhoto : supprime la photo à cette position pour ce user.
// Pas de delete Cloudinary ici (asset peut être réutilisé) — un cron
// périodique nettoiera les orphelins plus tard.
func (s *Store) DeletePhoto(ctx context.Context, userID int64, position int) error {
	_, err := s.pool.Exec(ctx,
		`DELETE FROM user_photos WHERE user_id = $1 AND position = $2`,
		userID, position,
	)
	if err != nil {
		return fmt.Errorf("profile: delete photo: %w", err)
	}
	return nil
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}
