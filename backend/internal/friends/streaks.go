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
		gap := -1
		if lastStreakDay != nil {
			gap = daysBetweenUTC(*lastStreakDay, now)
		}
		if lastStreakDay == nil || gap > 1 {
			// Reset. Si on avait un streak ≥ 2, snapshot pour permettre
			// une restauration ultérieure (lost_streak / lost_at).
			if currentStreak >= 2 && lastStreakDay != nil {
				if _, err := tx.Exec(ctx,
					`UPDATE friend_streaks
					 SET lost_streak = $2, lost_at = $3::date
					 WHERE friend_id = $1`,
					friendID, currentStreak, lastStreakDay.UTC().Format("2006-01-02"),
				); err != nil {
					return Streak{}, fmt.Errorf("streak: snapshot lost: %w", err)
				}
			}
			newStreak = 1
		} else if gap == 1 {
			newStreak = currentStreak + 1
		}
		// gap == 0 → déjà compté aujourd'hui, no-op.
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

// RestoreWindow : nombre de jours pendant lesquels un streak perdu peut
// être restauré après sa perte. Compteurs mensuels mis à part.
const RestoreWindow = 7

// RestoreMonthlyQuota : jetons par user et par mois calendaire UTC.
const RestoreMonthlyQuota = 3

// RestoreResult : état renvoyé par RestoreStreak.
type RestoreResult struct {
	// True si les deux ont accepté et que le streak est désormais restauré.
	Restored bool
	// True si seul le caller a posé sa demande, on attend l'autre côté.
	Pending bool
	// True si l'autre côté avait déjà demandé — c'est la mutual consent.
	PeerWasWaiting bool
	// Streak final si Restored=true.
	NewStreak int
	// Compteur restant ce mois pour le caller (après éventuelle conso).
	RemainingThisMonth int
	// Codes erreur applicatifs.
	ErrCode string
}

// monthKeyUTC : "2026-05" — UTC. Sert au reset du compteur mensuel.
func monthKeyUTC(now time.Time) string { return now.UTC().Format("2006-01") }

// RestoreStreak : implémente l'algorithme de restauration mutuelle.
// Voir CLAUDE.md règle d'or #1 — aucune écriture du contenu de message
// ici, on ne touche que les compteurs et l'état du streak.
//
// Codes ErrCode possibles :
//   "no_loss"          : rien à restaurer (streak vivant ou jamais perdu)
//   "window_expired"   : lost_at > 7 jours
//   "quota_exhausted"  : caller a utilisé ses 3 restaurations ce mois
//   "not_member"       : caller pas membre de l'amitié
func RestoreStreak(ctx context.Context, tx pgx.Tx, friendID, userID int64, now time.Time) (RestoreResult, error) {
	today := now.UTC()
	todayDate := today.Format("2006-01-02")

	// 1. Lire la friendship pour savoir si user est A ou B.
	var userAID, userBID int64
	if err := tx.QueryRow(ctx,
		`SELECT user_a_id, user_b_id FROM friends WHERE id = $1`, friendID,
	).Scan(&userAID, &userBID); err != nil {
		return RestoreResult{}, fmt.Errorf("restore: load friend: %w", err)
	}
	isA := userID == userAID
	isB := userID == userBID
	if !isA && !isB {
		return RestoreResult{ErrCode: "not_member"}, nil
	}
	peerID := userBID
	if isB {
		peerID = userAID
	}

	// 2. Lire / créer la ligne friend_streaks.
	if _, err := tx.Exec(ctx,
		`INSERT INTO friend_streaks (friend_id) VALUES ($1)
		 ON CONFLICT (friend_id) DO NOTHING`, friendID,
	); err != nil {
		return RestoreResult{}, fmt.Errorf("restore: upsert row: %w", err)
	}
	var (
		currentStreak int
		lastStreakDay *time.Time
		lostStreak    *int
		lostAt        *time.Time
		reqAAt        *time.Time
		reqBAt        *time.Time
	)
	if err := tx.QueryRow(ctx,
		`SELECT current_streak, last_streak_day, lost_streak, lost_at,
		        restore_req_a_at, restore_req_b_at
		 FROM friend_streaks WHERE friend_id = $1`, friendID,
	).Scan(&currentStreak, &lastStreakDay, &lostStreak, &lostAt, &reqAAt, &reqBAt); err != nil {
		return RestoreResult{}, fmt.Errorf("restore: read row: %w", err)
	}

	// 3. Snapshot tardif si nécessaire : streak ≥ 2 et > 1 jour sans bump
	//    sans qu'aucun message n'ait été envoyé depuis (donc lost_streak
	//    pas encore posé). On le pose maintenant pour permettre la
	//    restauration.
	if (lostStreak == nil || *lostStreak == 0) &&
		currentStreak >= 2 && lastStreakDay != nil &&
		daysBetweenUTC(*lastStreakDay, now) > 1 {
		if _, err := tx.Exec(ctx,
			`UPDATE friend_streaks
			 SET lost_streak = $2, lost_at = $3::date,
			     current_streak = 0
			 WHERE friend_id = $1`,
			friendID, currentStreak, lastStreakDay.UTC().Format("2006-01-02"),
		); err != nil {
			return RestoreResult{}, fmt.Errorf("restore: late snapshot: %w", err)
		}
		ls := currentStreak
		la := *lastStreakDay
		lostStreak = &ls
		lostAt = &la
	}

	// 4. Vérifs métier.
	if lostStreak == nil || *lostStreak < 2 {
		return RestoreResult{ErrCode: "no_loss"}, nil
	}
	if lostAt == nil || daysBetweenUTC(*lostAt, now) > RestoreWindow {
		return RestoreResult{ErrCode: "window_expired"}, nil
	}

	// 5. Compteur mensuel du caller — reset si le mois courant a changé.
	currentMonth := monthKeyUTC(now)
	var (
		used  int
		month string
	)
	if err := tx.QueryRow(ctx,
		`SELECT streak_restores_used, streak_restores_month
		 FROM users WHERE id = $1`, userID,
	).Scan(&used, &month); err != nil {
		return RestoreResult{}, fmt.Errorf("restore: read user quota: %w", err)
	}
	if month != currentMonth {
		used = 0
	}
	if used >= RestoreMonthlyQuota {
		return RestoreResult{ErrCode: "quota_exhausted", RemainingThisMonth: 0}, nil
	}

	// 6. Marque la demande côté caller (idempotent — re-clic ré-arme le ts).
	col := "restore_req_a_at"
	if isB {
		col = "restore_req_b_at"
	}
	if _, err := tx.Exec(ctx,
		fmt.Sprintf("UPDATE friend_streaks SET %s = $2 WHERE friend_id = $1", col),
		friendID, now,
	); err != nil {
		return RestoreResult{}, fmt.Errorf("restore: mark request: %w", err)
	}

	// 7. Vérifie si l'autre côté a déjà demandé dans la fenêtre. Si oui,
	//    on consomme un jeton à chaque user et on restaure.
	peerReq := reqBAt
	if isB {
		peerReq = reqAAt
	}
	mutual := peerReq != nil && now.Sub(*peerReq) < RestoreWindow*24*time.Hour

	if !mutual {
		// 7a. En attente du peer. On ne consomme pas encore le jeton.
		return RestoreResult{
			Pending:            true,
			RemainingThisMonth: RestoreMonthlyQuota - used,
		}, nil
	}

	// 7b. Consensus : consomme 1 jeton chacun, restaure, reset les flags.
	if err := bumpUserQuota(ctx, tx, userID, used, currentMonth); err != nil {
		return RestoreResult{}, err
	}
	if err := bumpUserQuota(ctx, tx, peerID, -1, currentMonth); err != nil {
		// -1 = signal "lire la valeur avant d'incrémenter"
		return RestoreResult{}, err
	}

	restored := *lostStreak
	if _, err := tx.Exec(ctx,
		`UPDATE friend_streaks
		 SET current_streak = $2, last_streak_day = $3::date,
		     lost_streak = NULL, lost_at = NULL,
		     restore_req_a_at = NULL, restore_req_b_at = NULL,
		     updated_at = now()
		 WHERE friend_id = $1`,
		friendID, restored, todayDate,
	); err != nil {
		return RestoreResult{}, fmt.Errorf("restore: apply: %w", err)
	}

	return RestoreResult{
		Restored:           true,
		PeerWasWaiting:     true,
		NewStreak:          restored,
		RemainingThisMonth: RestoreMonthlyQuota - (used + 1),
	}, nil
}

// bumpUserQuota : incrémente le compteur mensuel d'un user. Si `prevUsed`
// vaut -1, on relit la valeur en DB d'abord (cas peer dans la même tx).
func bumpUserQuota(ctx context.Context, tx pgx.Tx, userID int64, prevUsed int, currentMonth string) error {
	if prevUsed < 0 {
		var used int
		var month string
		if err := tx.QueryRow(ctx,
			`SELECT streak_restores_used, streak_restores_month FROM users WHERE id = $1`,
			userID,
		).Scan(&used, &month); err != nil {
			return fmt.Errorf("restore: read peer quota: %w", err)
		}
		if month != currentMonth {
			used = 0
		}
		prevUsed = used
	}
	if _, err := tx.Exec(ctx,
		`UPDATE users SET streak_restores_used = $2, streak_restores_month = $3 WHERE id = $1`,
		userID, prevUsed+1, currentMonth,
	); err != nil {
		return fmt.Errorf("restore: write quota: %w", err)
	}
	return nil
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
