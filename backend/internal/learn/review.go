package learn

import (
	"context"
	"fmt"
	"html"
	"strings"
	"time"
)

// Items de révision : fautes corrigées extraites par l'analyse IA de fin de
// conversation (ws.SessionAnalyzer). Matériau de la « leçon du jour » —
// une leçon éphémère personnalisée assemblée depuis les fautes non encore
// consommées. Même statut de confidentialité que les vocab_entries : on ne
// stocke QUE le matériau pédagogique dérivé, jamais la transcription.

// Bornes défensives : une faute est un fragment court, une note une phrase.
const (
	reviewTextMax = 200
	reviewNoteMax = 300
)

// ReviewItem : une faute corrigée, telle que rejouée dans la leçon du jour.
type ReviewItem struct {
	ID        int64     `json:"id"`
	Lang      string    `json:"lang"`
	Original  string    `json:"original"`
	Corrected string    `json:"corrected"`
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"created_at"`
}

// AddReviewItem persiste une faute corrigée. Re-commettre la même faute
// rafraîchit l'item (created_at + note) et le rend à nouveau consommable au
// lieu d'empiler un doublon. Les textes sont trim + tronqués + HTML-escapés
// (règle d'or #2 — texte libre rendu côté client).
func (s *Store) AddReviewItem(ctx context.Context, userID int64, lang, original, corrected, note string) error {
	original = sanitizeReviewText(original, reviewTextMax)
	corrected = sanitizeReviewText(corrected, reviewTextMax)
	note = sanitizeReviewText(note, reviewNoteMax)
	if original == "" || corrected == "" {
		return fmt.Errorf("learn: review item requires original and corrected")
	}
	const q = `
		INSERT INTO learn_review_items (user_id, lang, original, corrected, note)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, lang, original, corrected) DO UPDATE
		    SET note        = EXCLUDED.note,
		        created_at  = now(),
		        consumed_at = NULL`
	if _, err := s.pool.Exec(ctx, q, userID, lang, original, corrected, note); err != nil {
		return fmt.Errorf("learn: add review item: %w", err)
	}
	return nil
}

// PendingReviewItems liste les fautes non consommées d'un user pour une
// langue, plus récentes d'abord, bornées à limit.
func (s *Store) PendingReviewItems(ctx context.Context, userID int64, lang string, limit int) ([]ReviewItem, error) {
	const q = `
		SELECT id, lang, original, corrected, note, created_at
		FROM learn_review_items
		WHERE user_id = $1 AND lang = $2 AND consumed_at IS NULL
		ORDER BY created_at DESC
		LIMIT $3`
	rows, err := s.pool.Query(ctx, q, userID, lang, limit)
	if err != nil {
		return nil, fmt.Errorf("learn: pending review items: %w", err)
	}
	defer rows.Close()
	out := []ReviewItem{}
	for rows.Next() {
		var it ReviewItem
		if err := rows.Scan(&it.ID, &it.Lang, &it.Original, &it.Corrected, &it.Note, &it.CreatedAt); err != nil {
			return nil, fmt.Errorf("learn: scan review item: %w", err)
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// ConsumeReviewItems marque des items comme joués (leçon du jour complétée).
// Le filtre user_id garantit qu'un user ne consomme que ses propres items.
func (s *Store) ConsumeReviewItems(ctx context.Context, userID int64, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	const q = `
		UPDATE learn_review_items SET consumed_at = now()
		WHERE user_id = $1 AND id = ANY($2) AND consumed_at IS NULL`
	if _, err := s.pool.Exec(ctx, q, userID, ids); err != nil {
		return fmt.Errorf("learn: consume review items: %w", err)
	}
	return nil
}

// sanitizeReviewText : trim, tronque (par runes) puis échappe le HTML.
// Miroir de vocab.sanitize.
func sanitizeReviewText(s string, max int) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > max {
		s = string(r[:max])
	}
	return html.EscapeString(s)
}
