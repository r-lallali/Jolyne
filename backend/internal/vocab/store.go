// Package vocab : carnet de vocabulaire. Stocke les mots qu'un user
// sauvegarde depuis le popover de traduction (term + traduction + paire de
// langues) dans Postgres, et expose un listing/suppression par user. C'est
// la première brique de rétention (révision espacée à venir).
//
// Les champs texte (term, translation) sont trim + tronqués + HTML-escapés
// au moment de l'insert (règle d'or #2 : aucun texte libre rendu côté client
// sans échappement). Le front décode les entités à l'affichage.
package vocab

import (
	"context"
	"errors"
	"fmt"
	"html"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Bornes défensives, alignées sur la cible produit : la traduction vise un mot
// ou une phrase courte (cf. maxTextRunes côté handler translate = 500).
const (
	TermMax  = 500
	TransMax = 500
)

var ErrNotFound = errors.New("vocab: entry not found")

// Entry : une entrée du carnet telle que renvoyée au front.
type Entry struct {
	ID          int64     `json:"id"`
	Term        string    `json:"term"`
	Translation string    `json:"translation"`
	SourceLang  string    `json:"source_lang"`
	TargetLang  string    `json:"target_lang"`
	CreatedAt   time.Time `json:"created_at"`
}

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// Add insère une entrée. Re-sauvegarder le même terme dans le même sens est
// idempotent : on rafraîchit created_at (le mot remonte en haut du carnet)
// plutôt que de créer un doublon. Renvoie l'entrée persistée.
func (s *Store) Add(ctx context.Context, userID int64, e Entry) (Entry, error) {
	term := sanitize(e.Term, TermMax)
	translation := sanitize(e.Translation, TransMax)
	if term == "" || translation == "" {
		return Entry{}, fmt.Errorf("vocab: term and translation required")
	}
	const q = `
		INSERT INTO vocab_entries (user_id, term, translation, source_lang, target_lang)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, term, source_lang, target_lang) DO UPDATE
		    SET translation = EXCLUDED.translation,
		        created_at  = now()
		RETURNING id, term, translation, source_lang, target_lang, created_at`
	var out Entry
	err := s.pool.QueryRow(ctx, q, userID, term, translation, e.SourceLang, e.TargetLang).
		Scan(&out.ID, &out.Term, &out.Translation, &out.SourceLang, &out.TargetLang, &out.CreatedAt)
	if err != nil {
		return Entry{}, fmt.Errorf("vocab: add: %w", err)
	}
	return out, nil
}

// List renvoie le carnet d'un user, du plus récent au plus ancien.
func (s *Store) List(ctx context.Context, userID int64) ([]Entry, error) {
	const q = `
		SELECT id, term, translation, source_lang, target_lang, created_at
		FROM vocab_entries
		WHERE user_id = $1
		ORDER BY created_at DESC`
	rows, err := s.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("vocab: list: %w", err)
	}
	defer rows.Close()
	out := []Entry{}
	for rows.Next() {
		var e Entry
		if err := rows.Scan(&e.ID, &e.Term, &e.Translation, &e.SourceLang, &e.TargetLang, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("vocab: scan: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// Delete retire une entrée. Le filtre user_id garantit qu'un user ne peut
// supprimer que ses propres mots (pas d'IDOR). ErrNotFound si rien supprimé.
func (s *Store) Delete(ctx context.Context, userID, id int64) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM vocab_entries WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return fmt.Errorf("vocab: delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// sanitize : trim, tronque (par runes) puis échappe le HTML. Mirroir de
// profile.sanitizeField — texte libre rendu côté client.
func sanitize(s string, limit int) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > limit {
		s = string(r[:limit])
	}
	return html.EscapeString(s)
}
