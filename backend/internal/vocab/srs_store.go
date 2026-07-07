package vocab

import (
	"context"
	"errors"
	"fmt"
	"html"
	"time"

	"github.com/jackc/pgx/v5"
)

// ReviewEntry : une entrée due, telle que servie à l'écran de révision.
type ReviewEntry struct {
	Entry
	DueAt time.Time `json:"due_at"`
}

// Due renvoie les entrées dues d'un user (échéance la plus ancienne d'abord,
// bornées à limit) et le nombre total d'entrées dues.
func (s *Store) Due(ctx context.Context, userID int64, limit int) ([]ReviewEntry, int, error) {
	const q = `
		SELECT id, term, translation, source_lang, target_lang, created_at, due_at
		FROM vocab_entries
		WHERE user_id = $1 AND due_at <= now()
		ORDER BY due_at ASC
		LIMIT $2`
	rows, err := s.pool.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, 0, fmt.Errorf("vocab: due: %w", err)
	}
	defer rows.Close()
	out := []ReviewEntry{}
	for rows.Next() {
		var e ReviewEntry
		if err := rows.Scan(&e.ID, &e.Term, &e.Translation, &e.SourceLang, &e.TargetLang, &e.CreatedAt, &e.DueAt); err != nil {
			return nil, 0, fmt.Errorf("vocab: scan due: %w", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	var total int
	if err := s.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM vocab_entries WHERE user_id = $1 AND due_at <= now()`,
		userID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("vocab: due count: %w", err)
	}
	return out, total, nil
}

// DueCount : nombre d'entrées dues (badge côté carnet).
func (s *Store) DueCount(ctx context.Context, userID int64) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM vocab_entries WHERE user_id = $1 AND due_at <= now()`,
		userID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("vocab: due count: %w", err)
	}
	return n, nil
}

// ApplyReview applique une note SM-2 à une entrée et renvoie la prochaine
// échéance. Transactionnel (SELECT FOR UPDATE) : deux onglets qui notent la
// même carte ne corrompent pas l'état. Le filtre user_id évite l'IDOR.
func (s *Store) ApplyReview(ctx context.Context, userID, id int64, grade Grade, now time.Time) (time.Time, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return time.Time{}, fmt.Errorf("vocab: review begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var st SRSState
	err = tx.QueryRow(ctx, `
		SELECT ease, interval_days, reps, lapses
		FROM vocab_entries
		WHERE id = $1 AND user_id = $2
		FOR UPDATE`, id, userID).
		Scan(&st.Ease, &st.IntervalDays, &st.Reps, &st.Lapses)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, ErrNotFound
	}
	if err != nil {
		return time.Time{}, fmt.Errorf("vocab: review load: %w", err)
	}

	st, dueAt := NextReview(st, grade, now)
	_, err = tx.Exec(ctx, `
		UPDATE vocab_entries
		SET ease = $3, interval_days = $4, reps = $5, lapses = $6, due_at = $7
		WHERE id = $1 AND user_id = $2`,
		id, userID, st.Ease, st.IntervalDays, st.Reps, st.Lapses, dueAt)
	if err != nil {
		return time.Time{}, fmt.Errorf("vocab: review update: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return time.Time{}, fmt.Errorf("vocab: review commit: %w", err)
	}
	return dueAt, nil
}

// DueTerms renvoie jusqu'à limit termes dus dans une langue donnée, décodés
// (texte brut) pour pouvoir être injectés dans le prompt du prof IA.
func (s *Store) DueTerms(ctx context.Context, userID int64, lang string, limit int) ([]string, error) {
	const q = `
		SELECT term FROM vocab_entries
		WHERE user_id = $1 AND source_lang = $2 AND due_at <= now()
		ORDER BY due_at ASC
		LIMIT $3`
	rows, err := s.pool.Query(ctx, q, userID, lang, limit)
	if err != nil {
		return nil, fmt.Errorf("vocab: due terms: %w", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, fmt.Errorf("vocab: scan due term: %w", err)
		}
		out = append(out, html.UnescapeString(t))
	}
	return out, rows.Err()
}

// ReviewTermsInContext note « good » des termes vus/utilisés en contexte dans
// une conversation (réactivation). Conservateur : seules les entrées encore
// dues sont avancées — croiser un mot déjà planifié loin devant ne repousse
// pas son échéance. `terms` arrive en texte brut (sortie de DueTerms) ; les
// lignes sont stockées échappées, on ré-échappe pour matcher.
func (s *Store) ReviewTermsInContext(ctx context.Context, userID int64, lang string, terms []string, now time.Time) error {
	for _, t := range terms {
		escaped := html.EscapeString(t)
		var id int64
		err := s.pool.QueryRow(ctx, `
			SELECT id FROM vocab_entries
			WHERE user_id = $1 AND source_lang = $2 AND term = $3 AND due_at <= now()`,
			userID, lang, escaped).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return fmt.Errorf("vocab: review in context: %w", err)
		}
		if _, err := s.ApplyReview(ctx, userID, id, GradeGood, now); err != nil && !errors.Is(err, ErrNotFound) {
			return err
		}
	}
	return nil
}
