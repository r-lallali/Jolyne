package friends

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// StreakLossNotifier matérialise la fin d'un streak dans le chat ami via
// un message système permanent. Tourne périodiquement, indépendamment du
// fait que l'un des amis soit connecté ou non — d'où la persistance.
//
// Étape 1 : snapshot des streaks qui ont expiré sans qu'aucun message
//
//	n'ait déclenché le snapshot in-tx (cf. UpdateStreakOnMessage).
//	Critère : current_streak ≥ 2 ET last_streak_day < hier UTC ET
//	lost_streak NULL.
//
// Étape 2 : pour chaque ligne avec lost_streak ≥ 2 ET lost_notified_at
//
//	NULL, insérer un message system_streak_lost dans le chat et
//	poser lost_notified_at = now() (idempotence du cron).
//
// La fonction publie aussi un envelope "msg" sur le channel friend pour
// que les peers actuellement connectés voient apparaître la ligne en
// temps réel — best-effort, le hook publish est passé en paramètre pour
// éviter une dépendance circulaire avec le package ws.
type StreakLossPublisher func(ctx context.Context, friendID, msgID, senderID int64, body, kind, payload, sentAt string)

// RunStreakLossOnce exécute une passe complète. Renvoie le nombre de
// lignes notifiées (utile pour les tests). Aucune erreur DB n'est fatale
// — on log et on continue avec les autres lignes.
func RunStreakLossOnce(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger, publish StreakLossPublisher) (int, error) {
	if pool == nil {
		return 0, fmt.Errorf("streak loss: pool nil")
	}
	// Étape 1 : snapshot tardif des streaks expirés sans transaction. Une
	// seule requête SQL atomique — on calcule lost_streak/lost_at depuis
	// les colonnes actuelles et on remet current_streak à 0.
	if _, err := pool.Exec(ctx, `
		UPDATE friend_streaks
		SET lost_streak = current_streak,
		    lost_at = last_streak_day,
		    current_streak = 0
		WHERE current_streak >= 2
		  AND last_streak_day IS NOT NULL
		  AND last_streak_day < ((now() AT TIME ZONE 'UTC')::date - INTERVAL '1 day')
		  AND lost_streak IS NULL
	`); err != nil {
		// Pas fatal — on retente au tick suivant.
		if log != nil {
			log.Warn("streak loss cron: snapshot failed", "err", err)
		}
	}

	// Étape 2 : ligne système pour chaque perte non encore notifiée.
	rows, err := pool.Query(ctx, `
		SELECT fs.friend_id, fs.lost_streak, f.user_a_id
		FROM friend_streaks fs
		JOIN friends f ON f.id = fs.friend_id
		WHERE fs.lost_streak IS NOT NULL
		  AND fs.lost_streak >= 2
		  AND fs.lost_notified_at IS NULL
	`)
	if err != nil {
		return 0, fmt.Errorf("streak loss: list pending: %w", err)
	}
	type pending struct {
		friendID    int64
		lostStreak  int
		userAID     int64
	}
	var todo []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.friendID, &p.lostStreak, &p.userAID); err != nil {
			rows.Close()
			return 0, fmt.Errorf("streak loss: scan: %w", err)
		}
		todo = append(todo, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("streak loss: rows: %w", err)
	}

	count := 0
	for _, p := range todo {
		if err := insertStreakLossMessage(ctx, pool, p.friendID, p.userAID, p.lostStreak, publish); err != nil {
			if log != nil {
				log.Warn("streak loss cron: insert", "friend_id", p.friendID, "err", err)
			}
			continue
		}
		count++
	}
	return count, nil
}

// insertStreakLossMessage insère la ligne système et pose lost_notified_at
// dans la MÊME transaction — garantit qu'on ne notifie pas deux fois si
// le cron tourne en parallèle (lock pessimiste sur la ligne friend_streaks).
func insertStreakLossMessage(ctx context.Context, pool *pgxpool.Pool, friendID, senderID int64, lostStreak int, publish StreakLossPublisher) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// SELECT FOR UPDATE pour éviter qu'un deuxième process insère un
	// doublon entre la lecture et l'écriture.
	var notified *time.Time
	if err := tx.QueryRow(ctx,
		`SELECT lost_notified_at FROM friend_streaks WHERE friend_id = $1 FOR UPDATE`,
		friendID,
	).Scan(&notified); err != nil {
		return fmt.Errorf("select for update: %w", err)
	}
	if notified != nil {
		// Une autre passe a déjà notifié — rien à faire.
		return tx.Commit(ctx)
	}

	body := "🔥 Streak de " + strconv.Itoa(lostStreak) + " jours perdu"
	payload := `{"days":` + strconv.Itoa(lostStreak) + `}`

	var (
		msgID  int64
		sentAt time.Time
	)
	if err := tx.QueryRow(ctx, `
		INSERT INTO friend_messages (friend_id, sender_id, body, kind, payload)
		VALUES ($1, $2, $3, $4, $5::jsonb)
		RETURNING id, sent_at
	`, friendID, senderID, body, MessageKindStreakLost, payload).Scan(&msgID, &sentAt); err != nil {
		return fmt.Errorf("insert msg: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`UPDATE friend_streaks SET lost_notified_at = now() WHERE friend_id = $1`,
		friendID,
	); err != nil {
		return fmt.Errorf("mark notified: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE friends SET last_message_at = $2 WHERE id = $1`,
		friendID, sentAt,
	); err != nil {
		return fmt.Errorf("bump last_message_at: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	if publish != nil {
		publish(ctx, friendID, msgID, senderID, body, MessageKindStreakLost, payload, sentAt.UTC().Format(time.RFC3339))
	}
	return nil
}

// StartStreakLossCron lance la boucle en goroutine — un tick immédiat
// puis tous les `interval`. S'arrête quand `ctx` est cancel.
func StartStreakLossCron(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger, interval time.Duration, publish StreakLossPublisher) {
	if interval <= 0 {
		interval = 15 * time.Minute
	}
	go func() {
		// Premier passage immédiat pour rattraper les pertes survenues
		// pendant un downtime éventuel.
		if n, err := RunStreakLossOnce(ctx, pool, log, publish); err != nil {
			if log != nil {
				log.Warn("streak loss cron: initial run", "err", err)
			}
		} else if log != nil && n > 0 {
			log.Info("streak loss cron: notified", "count", n)
		}
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				n, err := RunStreakLossOnce(ctx, pool, log, publish)
				if err != nil && log != nil {
					log.Warn("streak loss cron: tick", "err", err)
				} else if log != nil && n > 0 {
					log.Info("streak loss cron: notified", "count", n)
				}
			}
		}
	}()
}

// Garde une référence à pgx pour silencer un avertissement éventuel si
// le linter pense que l'import n'est utilisé que via types.
var _ = pgx.ErrNoRows
