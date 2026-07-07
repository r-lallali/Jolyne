package learn

import (
	"context"
	"fmt"
	"time"
)

// « Leçon du jour » : leçon éphémère personnalisée, assemblée depuis les
// fautes corrigées de l'apprenant (learn_review_items, alimentés par
// l'analyse IA de fin de conversation). Aucune génération supplémentaire :
// les exercices sont dérivés côté client des paires original → corrigé.

const (
	// DailyLessonMin : en-deçà, pas de leçon (pas assez de matière pour des
	// exercices variés) — l'endpoint renvoie 204.
	DailyLessonMin = 4
	// DailyLessonMax : items servis par leçon (les plus récents d'abord).
	DailyLessonMax = 8
	// DailyReviewXP : XP créditée à la complétion. Compte pour l'objectif
	// quotidien et le streak, comme une leçon de cours.
	DailyReviewXP = 10
)

// CompleteDailyReview consomme les items joués et crédite XP + streak,
// exactement comme une leçon de cours (state partagé) mais sans toucher aux
// cœurs (pas d'enjeu d'échec sur une révision) ni à learn_progress (pas une
// leçon du curriculum). ErrNotFound si aucun item n'était consommable —
// re-soumettre la même leçon ne farme pas d'XP.
func (s *Store) CompleteDailyReview(ctx context.Context, userID int64, itemIDs []int64, premium bool, now time.Time) (CompleteResult, error) {
	if len(itemIDs) == 0 {
		return CompleteResult{}, ErrNotFound
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CompleteResult{}, fmt.Errorf("learn: daily begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	tag, err := tx.Exec(ctx,
		`UPDATE learn_review_items SET consumed_at = now()
		 WHERE user_id = $1 AND id = ANY($2) AND consumed_at IS NULL`,
		userID, itemIDs)
	if err != nil {
		return CompleteResult{}, fmt.Errorf("learn: daily consume: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return CompleteResult{}, ErrNotFound
	}

	if err := ensureState(ctx, tx, userID); err != nil {
		return CompleteResult{}, fmt.Errorf("learn: daily ensure state: %w", err)
	}

	var (
		totalXP       int
		currentStreak int
		longestStreak int
		lastDay       *time.Time
		lastMilestone int
	)
	if err := tx.QueryRow(ctx,
		`SELECT total_xp, current_streak, longest_streak, last_active_day, last_milestone
		 FROM learn_state WHERE user_id = $1 FOR UPDATE`, userID,
	).Scan(&totalXP, &currentStreak, &longestStreak, &lastDay, &lastMilestone); err != nil {
		return CompleteResult{}, fmt.Errorf("learn: daily lock state: %w", err)
	}

	todayStr := now.UTC().Format("2006-01-02")
	sk := applyStreak(currentStreak, longestStreak, lastDay, lastMilestone, now)
	totalXP += DailyReviewXP

	if _, err := tx.Exec(ctx,
		`UPDATE learn_state
		 SET total_xp = $2, current_streak = $3, longest_streak = $4,
		     last_active_day = $5::date, last_milestone = $6, updated_at = now()
		 WHERE user_id = $1`,
		userID, totalXP, sk.Streak, sk.Longest, todayStr, sk.PersistedMilestone,
	); err != nil {
		return CompleteResult{}, fmt.Errorf("learn: daily update state: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO learn_daily (user_id, day, xp) VALUES ($1, $2::date, $3)
		 ON CONFLICT (user_id, day) DO UPDATE SET xp = learn_daily.xp + EXCLUDED.xp`,
		userID, todayStr, DailyReviewXP,
	); err != nil {
		return CompleteResult{}, fmt.Errorf("learn: daily xp: %w", err)
	}

	// Succès XP / streak (les succès « lessons » ne comptent que les leçons
	// du curriculum — une révision n'en est pas une).
	newAch := []string{}
	for _, def := range Achievements {
		ok := false
		switch def.Kind {
		case KindXP:
			ok = totalXP >= def.Threshold
		case KindStreak:
			ok = sk.Streak >= def.Threshold
		}
		if !ok {
			continue
		}
		tag, err := tx.Exec(ctx,
			`INSERT INTO learn_achievements (user_id, code) VALUES ($1, $2)
			 ON CONFLICT (user_id, code) DO NOTHING`, userID, def.Code)
		if err != nil {
			return CompleteResult{}, fmt.Errorf("learn: daily achievement: %w", err)
		}
		if tag.RowsAffected() > 0 {
			newAch = append(newAch, def.Code)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return CompleteResult{}, fmt.Errorf("learn: daily commit: %w", err)
	}

	st, err := s.State(ctx, userID, premium, now)
	if err != nil {
		return CompleteResult{}, err
	}
	return CompleteResult{
		XPAwarded:          DailyReviewXP,
		State:              st,
		NewAchievements:    newAch,
		StreakIncreased:    sk.Increased,
		NewStreakMilestone: sk.NewMilestone,
	}, nil
}
