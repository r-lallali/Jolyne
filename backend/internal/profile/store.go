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
	IsVerified       bool
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
		       updated_at, is_verified
		FROM user_profiles WHERE user_id = $1`
	var p Profile
	err := s.pool.QueryRow(ctx, q, userID).Scan(
		&p.UserID, &p.DisplayName, &p.Bio, &p.Birthdate,
		&p.Prompt1, &p.Answer1, &p.Prompt2, &p.Answer2, &p.Prompt3, &p.Answer3,
		&p.UpdatedAt, &p.IsVerified,
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
		          updated_at, is_verified`
	var out Profile
	err := s.pool.QueryRow(ctx, q,
		p.UserID, p.DisplayName, p.Bio, p.Birthdate,
		p.Prompt1, p.Answer1, p.Prompt2, p.Answer2, p.Prompt3, p.Answer3,
	).Scan(
		&out.UserID, &out.DisplayName, &out.Bio, &out.Birthdate,
		&out.Prompt1, &out.Answer1, &out.Prompt2, &out.Answer2, &out.Prompt3, &out.Answer3,
		&out.UpdatedAt, &out.IsVerified,
	)
	if err != nil {
		return Profile{}, fmt.Errorf("profile: upsert: %w", err)
	}
	return out, nil
}

// UpsertDisplayName : raccourci utilisé par le signup pour stocker
// uniquement le pseudo visible aux amis sans toucher aux autres champs
// du profil (bio / birthdate / prompts restent vides). Implémente
// `users.ProfileWriter`.
func (s *Store) UpsertDisplayName(ctx context.Context, userID int64, displayName string) error {
	displayName = sanitizeField(displayName, DisplayNameMax)
	if displayName == "" {
		return nil
	}
	const q = `
		INSERT INTO user_profiles (user_id, display_name, updated_at)
		VALUES ($1, $2, now())
		ON CONFLICT (user_id) DO UPDATE SET
			display_name = EXCLUDED.display_name,
			updated_at   = now()`
	if _, err := s.pool.Exec(ctx, q, userID, displayName); err != nil {
		return fmt.Errorf("profile: upsert display_name: %w", err)
	}
	return nil
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
// Retourne la photo créée/mise à jour, et l'ancien public_id (si elle a été remplacée) pour nettoyage.
func (s *Store) SetPhoto(ctx context.Context, userID int64, position int, publicID string) (Photo, string, error) {
	if position < 1 || position > MaxPhotos {
		return Photo{}, "", fmt.Errorf("profile: position invalide (1..%d)", MaxPhotos)
	}
	publicID = strings.TrimSpace(publicID)
	if publicID == "" {
		return Photo{}, "", fmt.Errorf("profile: public_id vide")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Photo{}, "", fmt.Errorf("profile: set begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// 1. Récupérer l'ancien public_id s'il existe
	var oldPublicID string
	err = tx.QueryRow(ctx,
		`SELECT public_id FROM user_photos WHERE user_id = $1 AND position = $2`,
		userID, position,
	).Scan(&oldPublicID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Photo{}, "", fmt.Errorf("profile: set find old photo: %w", err)
	}

	// 2. Effectuer l'upsert
	const q = `
		INSERT INTO user_photos (user_id, position, public_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, position) DO UPDATE SET public_id = EXCLUDED.public_id
		RETURNING id, user_id, position, public_id`
	
	var p Photo
	err = tx.QueryRow(ctx, q, userID, position, publicID).Scan(
		&p.ID, &p.UserID, &p.Position, &p.PublicID,
	)
	if err != nil {
		return Photo{}, "", fmt.Errorf("profile: set photo exec: %w", err)
	}

	// 3. Si la photo principale (position 1) est modifiée, on décertifie le compte par sécurité
	if position == 1 && oldPublicID != "" && oldPublicID != publicID {
		_, err = tx.Exec(ctx,
			`UPDATE user_profiles SET is_verified = false, updated_at = now() WHERE user_id = $1`,
			userID,
		)
		if err != nil {
			return Photo{}, "", fmt.Errorf("profile: set reset verification: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return Photo{}, "", fmt.Errorf("profile: set commit tx: %w", err)
	}

	return p, oldPublicID, nil
}

// DeletePhoto : supprime la photo à cette position pour ce user et décale
// les photos suivantes vers la gauche (position-1) dans une transaction.
// Retourne le public_id de la photo supprimée pour nettoyage Cloudinary.
func (s *Store) DeletePhoto(ctx context.Context, userID int64, position int) (string, error) {
	if position < 1 || position > MaxPhotos {
		return "", fmt.Errorf("profile: position invalide (1..%d)", MaxPhotos)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("profile: delete begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// 1. Récupérer le public_id de la photo à supprimer
	var publicID string
	err = tx.QueryRow(ctx,
		`SELECT public_id FROM user_photos WHERE user_id = $1 AND position = $2`,
		userID, position,
	).Scan(&publicID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Rien à supprimer
			return "", nil
		}
		return "", fmt.Errorf("profile: delete find photo: %w", err)
	}

	// 2. Supprimer la photo
	_, err = tx.Exec(ctx,
		`DELETE FROM user_photos WHERE user_id = $1 AND position = $2`,
		userID, position,
	)
	if err != nil {
		return "", fmt.Errorf("profile: delete photo exec: %w", err)
	}

	// 3. Décaler les photos suivantes vers la gauche (position-1)
	_, err = tx.Exec(ctx,
		`UPDATE user_photos SET position = position - 1 WHERE user_id = $1 AND position > $2`,
		userID, position,
	)
	if err != nil {
		return "", fmt.Errorf("profile: delete shift photos: %w", err)
	}

	// 4. Si la photo principale (position 1) a été supprimée ou décalée,
	// et que le profil était certifié, on doit annuler la certification par sécurité !
	if position == 1 {
		_, err = tx.Exec(ctx,
			`UPDATE user_profiles SET is_verified = false, updated_at = now() WHERE user_id = $1`,
			userID,
		)
		if err != nil {
			return "", fmt.Errorf("profile: delete reset verification: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("profile: delete commit tx: %w", err)
	}

	return publicID, nil
}

// ReorderPhotos : réorganise les photos d'un user en une seule
// transaction. `ordering` contient les positions actuelles dans le
// nouvel ordre voulu (ex: [3,1,2] = la photo actuellement en position 3
// passe en 1, celle en 1 passe en 2, celle en 2 passe en 3).
// Étape 1 : déplace tout vers des positions négatives temporaires pour
// éviter les violations de contrainte unique (user_id, position).
// Étape 2 : applique l'ordre final.
func (s *Store) ReorderPhotos(ctx context.Context, userID int64, ordering []int) ([]Photo, error) {
	if len(ordering) == 0 {
		return []Photo{}, nil
	}
	for _, pos := range ordering {
		if pos < 1 || pos > MaxPhotos {
			return nil, fmt.Errorf("profile: reorder: position invalide %d", pos)
		}
	}
	// Vérifier les doublons dans ordering.
	seen := make(map[int]bool, len(ordering))
	for _, pos := range ordering {
		if seen[pos] {
			return nil, fmt.Errorf("profile: reorder: position dupliquée %d", pos)
		}
		seen[pos] = true
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("profile: reorder begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Vérifier que le nombre de photos correspond.
	var count int
	err = tx.QueryRow(ctx,
		`SELECT count(*) FROM user_photos WHERE user_id = $1`, userID,
	).Scan(&count)
	if err != nil {
		return nil, fmt.Errorf("profile: reorder count: %w", err)
	}
	if count != len(ordering) {
		return nil, fmt.Errorf("profile: reorder: ordering length %d != photo count %d", len(ordering), count)
	}

	// Récupérer l'identité de la photo actuellement en position 1
	// pour détecter si le main photo change (=> reset vérification).
	var oldMainPublicID string
	err = tx.QueryRow(ctx,
		`SELECT public_id FROM user_photos WHERE user_id = $1 AND position = 1`,
		userID,
	).Scan(&oldMainPublicID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("profile: reorder get main: %w", err)
	}

	// Étape 1 : positions temporaires négatives.
	for i, oldPos := range ordering {
		tmpPos := -(i + 1)
		_, err = tx.Exec(ctx,
			`UPDATE user_photos SET position = $1 WHERE user_id = $2 AND position = $3`,
			tmpPos, userID, oldPos,
		)
		if err != nil {
			return nil, fmt.Errorf("profile: reorder tmp pos: %w", err)
		}
	}

	// Étape 2 : positions finales.
	for i := range ordering {
		newPos := i + 1
		tmpPos := -(i + 1)
		_, err = tx.Exec(ctx,
			`UPDATE user_photos SET position = $1 WHERE user_id = $2 AND position = $3`,
			newPos, userID, tmpPos,
		)
		if err != nil {
			return nil, fmt.Errorf("profile: reorder final pos: %w", err)
		}
	}

	// Si la photo principale a changé, reset la vérification.
	if oldMainPublicID != "" {
		var newMainPublicID string
		err = tx.QueryRow(ctx,
			`SELECT public_id FROM user_photos WHERE user_id = $1 AND position = 1`,
			userID,
		).Scan(&newMainPublicID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("profile: reorder check main: %w", err)
		}
		if newMainPublicID != oldMainPublicID {
			_, err = tx.Exec(ctx,
				`UPDATE user_profiles SET is_verified = false, updated_at = now() WHERE user_id = $1`,
				userID,
			)
			if err != nil {
				return nil, fmt.Errorf("profile: reorder reset verification: %w", err)
			}
		}
	}

	// Lire les photos réordonnées.
	rows, err := tx.Query(ctx,
		`SELECT id, user_id, position, public_id FROM user_photos WHERE user_id = $1 ORDER BY position`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("profile: reorder list: %w", err)
	}
	defer rows.Close()
	out := make([]Photo, 0, len(ordering))
	for rows.Next() {
		var p Photo
		if err := rows.Scan(&p.ID, &p.UserID, &p.Position, &p.PublicID); err != nil {
			return nil, fmt.Errorf("profile: reorder scan: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("profile: reorder rows: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("profile: reorder commit: %w", err)
	}
	return out, nil
}

// MarkProfileVerified updates the verification status of a user profile.
func (s *Store) MarkProfileVerified(ctx context.Context, userID int64, verified bool) error {
	const q = `
		UPDATE user_profiles
		SET is_verified = $2, updated_at = now()
		WHERE user_id = $1`
	_, err := s.pool.Exec(ctx, q, userID, verified)
	if err != nil {
		return fmt.Errorf("profile: mark verified: %w", err)
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
