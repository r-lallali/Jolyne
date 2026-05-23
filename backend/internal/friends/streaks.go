package friends

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Streak : état dérivé renvoyé après update / lecture. Tous les champs
// calculés en tenant compte du jour UTC courant.
type Streak struct {
	Current      int        // 0 si expiré ou < seuil d'affichage
	AtRisk       bool       // last_streak_day = yesterday ET pas les deux aujourd'hui
	LastMilestone int       // déjà notifié
	LostStreak   int        // 0 si rien à restaurer
	LostAt       *time.Time // nil si pas perdu
	NewMilestone int        // > 0 si on vient de franchir un palier dans cette tx
}

// Liste des paliers déclencheurs de notif. Ordonnée croissant — on prend
// le plus haut atteint pour éviter de re-notifier en cas de restauration.
var StreakMilestones = []int{3, 7, 14, 30, 50, 100, 365}

// UpdateStreakOnMessage : appelé dans la transaction d'AppendMessage.
// Met à jour les compteurs et renvoie l'état post-update + le palier
// éventuellement franchi (le caller poussera la notif hors transaction).
func UpdateStreakOnMessage(ctx context.Context, tx pgx.Tx, friendID, senderID int64, now time.Time) (Streak, error) {
	today := now.UTC().Format("2006-01-02")

	// 1. Récupère les user IDs A/B pour savoir de quel côté on est.
	var userAID, userBID int64
	if err := tx.QueryRow(ctx,
		`SELECT user_a_id, user_b_id FROM friends WHERE id = $1`, friendID,
	).Scan(&userAID, &userBID); err != nil {
		return Streak{}, fmt.Errorf("streak: load friend: %w", err)
	}
	if senderID != userAID && senderID != userBID {
		return Streak{}, fmt.Errorf("streak: sender not part of friendship")
	}

	// 2. UPSERT la ligne friend_streaks (création paresseuse).
	if _, err := tx.Exec(ctx,
		`INSERT INTO friend_streaks (friend_id) VALUES ($1)
		 ON CONFLICT (friend_id) DO NOTHING`, friendID,
	); err != nil {
		return Streak{}, fmt.Errorf("streak: upsert row: %w", err)
	}

	// 3. Marque le sender comme ayant écrit aujourd'hui.
	col := "last_a_msg_day"
	if senderID == userBID {
		col = "last_b_msg_day"
	}
	if _, err := tx.Exec(ctx,
		fmt.Sprintf(
			`UPDATE friend_streaks SET %s = $2::date, updated_at = now() WHERE friend_id = $1`,
			col,
		),
		friendID, today,
	); err != nil {
		return Streak{}, fmt.Errorf("streak: mark msg day: %w", err)
	}

	// 4. Recalcule le current_streak. Règle :
	//    - both wrote today ET last_streak_day = today - 1 → +1
	//    - both wrote today ET last_streak_day = today → no-op
	//    - both wrote today ET (last_streak_day < today-1 ou NULL) → 1
	//    - sinon → no-op (état attentiste, on n'écrase pas current_streak)
	var (
		currentStreak  int
		lastStreakDay  *time.Time
		lastA          *time.Time
		lastB          *time.Time
		lastMilestone  int
		lostStreak     *int
		lostAt         *time.Time
	)
	if err := tx.QueryRow(ctx,
		`SELECT current_streak, last_streak_day, last_a_msg_day, last_b_msg_day,
		        last_milestone, lost_streak, lost_at
		 FROM friend_streaks WHERE friend_id = $1`, friendID,
	).Scan(&currentStreak, &lastStreakDay, &lastA, &lastB, &lastMilestone, &lostStreak, &lostAt); err != nil {
		return Streak{}, fmt.Errorf("streak: read row: %w", err)
	}

	bothToday := lastA != nil && lastB != nil &&
		lastA.UTC().Format("2006-01-02") == today &&
		lastB.UTC().Format("2006-01-02") == today

	newStreak := currentStreak
	if bothToday {
		if lastStreakDay == nil || daysBetweenUTC(*lastStreakDay, now) > 1 {
			newStreak = 1
		} else if daysBetweenUTC(*lastStreakDay, now) == 1 {
			newStreak = currentStreak + 1
		}
		// daysBetween = 0 → déjà compté aujourd'hui, no-op.
		if _, err := tx.Exec(ctx,
			`UPDATE friend_streaks
			 SET current_streak = $2, last_streak_day = $3::date, updated_at = now()
			 WHERE friend_id = $1`,
			friendID, newStreak, today,
		); err != nil {
			return Streak{}, fmt.Errorf("streak: bump: %w", err)
		}
	}

	// 5. Détermine si on franchit un palier (strictement supérieur au
	//    `last_milestone` enregistré).
	newMilestone := 0
	for _, m := range StreakMilestones {
		if newStreak >= m && m > lastMilestone {
			newMilestone = m
		}
	}
	if newMilestone > 0 {
		if _, err := tx.Exec(ctx,
			`UPDATE friend_streaks SET last_milestone = $2 WHERE friend_id = $1`,
			friendID, newMilestone,
		); err != nil {
			return Streak{}, fmt.Errorf("streak: milestone: %w", err)
		}
	}

	// 6. État "at risk" : last_streak_day = hier et pas les deux aujourd'hui
	//    et streak ≥ 2. Calculé pour l'affichage immédiat post-envoi.
	atRisk := false
	if lastStreakDay != nil && newStreak >= 2 {
		d := daysBetweenUTC(*lastStreakDay, now)
		if d == 1 && !bothToday {
			atRisk = true
		}
	}

	ls := 0
	if lostStreak != nil {
		ls = *lostStreak
	}
	return Streak{
		Current:       newStreak,
		AtRisk:        atRisk,
		LastMilestone: lastMilestone,
		LostStreak:    ls,
		LostAt:        lostAt,
		NewMilestone:  newMilestone,
	}, nil
}

func daysBetweenUTC(d time.Time, now time.Time) int {
	a := time.Date(d.UTC().Year(), d.UTC().Month(), d.UTC().Day(), 0, 0, 0, 0, time.UTC)
	b := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)
	return int(b.Sub(a).Hours() / 24)
}

// devnull pour silencer un warning si pgx.ErrNoRows n'est pas utilisé directement.
var _ = errors.New

// streakQueryRow : interface minimale pour lire un streak via pool ou tx.
type streakQueryRow interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// ReadStreak : lecture lazy d'un streak (même règles d'expiration et de
// at-risk que dans ListFor). Utilisé par l'endpoint profile pour
// décorer le header de conversation.
func ReadStreak(ctx context.Context, q streakQueryRow, friendID int64) (current int, atRisk bool, lostStreak int, lostAt *time.Time, err error) {
	const sql = `
		WITH today AS (SELECT (now() AT TIME ZONE 'UTC')::date AS d)
		SELECT
		  CASE
		    WHEN fs.last_streak_day IS NULL THEN 0
		    WHEN fs.last_streak_day >= (SELECT d FROM today) - 1 THEN fs.current_streak
		    ELSE 0
		  END AS streak,
		  COALESCE(
		    fs.last_streak_day = (SELECT d FROM today) - 1
		    AND fs.current_streak >= 2
		    AND (fs.last_a_msg_day IS DISTINCT FROM (SELECT d FROM today)
		         OR fs.last_b_msg_day IS DISTINCT FROM (SELECT d FROM today)),
		    false
		  ) AS at_risk,
		  COALESCE(fs.lost_streak, 0),
		  fs.lost_at
		FROM friend_streaks fs
		WHERE fs.friend_id = $1`
	err = q.QueryRow(ctx, sql, friendID).Scan(&current, &atRisk, &lostStreak, &lostAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, 0, nil, nil
	}
	return
}
