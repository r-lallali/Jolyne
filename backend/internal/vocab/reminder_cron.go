package vocab

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ralys/jolyne/backend/internal/push"
)

// Rappel de révision quotidien : « X mots t'attendent dans ton carnet ».
// Même modèle que friends.StartStreakLossCron : goroutine + ticker,
// indépendant de la présence en ligne du user. Garde-fous anti-spam :
//   - fenêtre d'envoi 16h-20h UTC (soirée Europe, cœur de l'audience) ;
//   - au plus un rappel par ~20 h (users.last_review_reminder_at) ;
//   - uniquement les users ayant ≥ reminderMinDue mots dus ET au moins un
//     appareil push enregistré.
const (
	reminderWindowStartUTC = 16
	reminderWindowEndUTC   = 20
	reminderMinDue         = 5
	reminderBatch          = 200
)

// RunReviewReminderOnce fait une passe d'envoi. Renvoie le nombre de rappels
// émis. Le last_review_reminder_at est posé AVANT l'envoi (best-effort) :
// un crash au milieu perd au pire un rappel, jamais n'en double.
func RunReviewReminderOnce(ctx context.Context, pool *pgxpool.Pool, sender *push.Sender, log *slog.Logger, now time.Time) (int, error) {
	if h := now.UTC().Hour(); h < reminderWindowStartUTC || h >= reminderWindowEndUTC {
		return 0, nil
	}
	const q = `
		SELECT u.id, COUNT(v.id) AS due
		FROM users u
		JOIN vocab_entries v ON v.user_id = u.id AND v.due_at <= now()
		WHERE (u.last_review_reminder_at IS NULL
		       OR u.last_review_reminder_at < now() - interval '20 hours')
		  AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = u.id)
		GROUP BY u.id
		HAVING COUNT(v.id) >= $1
		LIMIT $2`
	rows, err := pool.Query(ctx, q, reminderMinDue, reminderBatch)
	if err != nil {
		return 0, fmt.Errorf("vocab: reminder query: %w", err)
	}
	type target struct {
		userID int64
		due    int
	}
	var targets []target
	for rows.Next() {
		var t target
		if err := rows.Scan(&t.userID, &t.due); err != nil {
			rows.Close()
			return 0, fmt.Errorf("vocab: reminder scan: %w", err)
		}
		targets = append(targets, t)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	sent := 0
	for _, t := range targets {
		if _, err := pool.Exec(ctx,
			`UPDATE users SET last_review_reminder_at = now() WHERE id = $1`, t.userID); err != nil {
			if log != nil {
				log.Warn("vocab reminder mark", "err", err)
			}
			continue
		}
		sender.SendToUser(ctx, t.userID, push.Payload{
			Title: "Jolyne",
			Body:  fmt.Sprintf("📚 %d mots t'attendent dans ton carnet", t.due),
			URL:   "/vocab",
			Tag:   "vocab-review",
		})
		sent++
	}
	return sent, nil
}

// StartReviewReminderCron lance la boucle de rappel. À appeler une fois au
// boot, uniquement si le sender push est configuré.
func StartReviewReminderCron(ctx context.Context, pool *pgxpool.Pool, sender *push.Sender, log *slog.Logger, interval time.Duration) {
	if interval <= 0 {
		interval = 30 * time.Minute
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				n, err := RunReviewReminderOnce(ctx, pool, sender, log, time.Now())
				if err != nil && log != nil {
					log.Warn("vocab reminder cron: tick", "err", err)
				} else if log != nil && n > 0 {
					log.Info("vocab reminder cron: sent", "count", n)
				}
			}
		}
	}()
}
