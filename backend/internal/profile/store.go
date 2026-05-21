// Package profile : données de profil utilisateur (display_name, bio,
// birthdate) + photos hébergées sur Cloudinary (jusqu'à 6, position 1
// = principale visible dans le chat).
package profile

import (
	"context"
	"errors"
	"fmt"
	"html"
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
	// 3 slots Q&R style Hinge. PromptN = clé i18n d'un prompt fermé,
	// AnswerN = réponse libre (≤ AnswerMax). Slot vide = (zero, zero).
	Prompt1, Answer1 string
	Prompt2, Answer2 string
	Prompt3, Answer3 string
	UpdatedAt        time.Time
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
	PromptKeyMax   = 64
	AnswerMax      = 200
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
		SELECT user_id, display_name, bio, birthdate,
		       prompt_1, answer_1, prompt_2, answer_2, prompt_3, answer_3,
		       updated_at
		FROM user_profiles WHERE user_id = $1`
	var p Profile
	err := s.pool.QueryRow(ctx, q, userID).Scan(
		&p.UserID, &p.DisplayName, &p.Bio, &p.Birthdate,
		&p.Prompt1, &p.Answer1, &p.Prompt2, &p.Answer2, &p.Prompt3, &p.Answer3,
		&p.UpdatedAt,
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
	// Trim + truncate + escape HTML sur tous les champs libres (CLAUDE.md
	// règle d'or #2 : défense en profondeur côté serveur). Les Prompt{N}
	// sont des clés i18n d'une liste fermée — on les trim/tronque mais on
	// n'escape pas (l'UI les remplace par le libellé via lookup).
	p.DisplayName = sanitizeField(p.DisplayName, DisplayNameMax)
	p.Bio = sanitizeField(p.Bio, BioMax)
	p.Prompt1 = truncate(strings.TrimSpace(p.Prompt1), PromptKeyMax)
	p.Prompt2 = truncate(strings.TrimSpace(p.Prompt2), PromptKeyMax)
	p.Prompt3 = truncate(strings.TrimSpace(p.Prompt3), PromptKeyMax)
	p.Answer1 = sanitizeField(p.Answer1, AnswerMax)
	p.Answer2 = sanitizeField(p.Answer2, AnswerMax)
	p.Answer3 = sanitizeField(p.Answer3, AnswerMax)
	// Si le prompt est vide, on vide aussi la réponse — un slot orphelin
	// (answer sans prompt) ne s'affiche pas, autant le nettoyer.
	if p.Prompt1 == "" {
		p.Answer1 = ""
	}
	if p.Prompt2 == "" {
		p.Answer2 = ""
	}
	if p.Prompt3 == "" {
		p.Answer3 = ""
	}
	const q = `
		INSERT INTO user_profiles (
			user_id, display_name, bio, birthdate,
			prompt_1, answer_1, prompt_2, answer_2, prompt_3, answer_3,
			updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
		ON CONFLICT (user_id) DO UPDATE SET
			display_name = EXCLUDED.display_name,
			bio          = EXCLUDED.bio,
			birthdate    = EXCLUDED.birthdate,
			prompt_1     = EXCLUDED.prompt_1,
			answer_1     = EXCLUDED.answer_1,
			prompt_2     = EXCLUDED.prompt_2,
			answer_2     = EXCLUDED.answer_2,
			prompt_3     = EXCLUDED.prompt_3,
			answer_3     = EXCLUDED.answer_3,
			updated_at   = now()
		RETURNING user_id, display_name, bio, birthdate,
		          prompt_1, answer_1, prompt_2, answer_2, prompt_3, answer_3,
		          updated_at`
	var out Profile
	err := s.pool.QueryRow(ctx, q,
		p.UserID, p.DisplayName, p.Bio, p.Birthdate,
		p.Prompt1, p.Answer1, p.Prompt2, p.Answer2, p.Prompt3, p.Answer3,
	).Scan(
		&out.UserID, &out.DisplayName, &out.Bio, &out.Birthdate,
		&out.Prompt1, &out.Answer1, &out.Prompt2, &out.Answer2, &out.Prompt3, &out.Answer3,
		&out.UpdatedAt,
	)
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

// sanitizeField : trim, truncate puis escape HTML pour les champs texte
// libres rendus côté client. Voir Upsert pour la motivation.
func sanitizeField(s string, max int) string {
	return html.EscapeString(truncate(strings.TrimSpace(s), max))
}
