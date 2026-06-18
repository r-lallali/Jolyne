package learn

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("learn: not found")

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ---------------------------------------------------------------------------
// Contenu : upsert idempotent d'un cours complet (utilisé par le seed embarqué
// et le générateur Claude). On réécrit le contenu (titres, items) sans toucher
// aux progrès : les leçons sont identifiées par (unit.slug, lesson.slug) donc
// leur ID DB est préservé entre deux passes.
// ---------------------------------------------------------------------------

func (s *Store) UpsertCourse(ctx context.Context, c Course) error {
	if !IsSupportedLang(c.Lang) {
		return fmt.Errorf("learn: langue cible non supportée: %q", c.Lang)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("learn: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var courseID int64
	if err := tx.QueryRow(ctx,
		`INSERT INTO learn_courses (lang, title) VALUES ($1, $2)
		 ON CONFLICT (lang) DO UPDATE SET title = EXCLUDED.title, updated_at = now()
		 RETURNING id`, c.Lang, c.Title,
	).Scan(&courseID); err != nil {
		return fmt.Errorf("learn: upsert course: %w", err)
	}

	for ui, u := range c.Units {
		var unitID int64
		if err := tx.QueryRow(ctx,
			`INSERT INTO learn_units (course_id, slug, idx, title) VALUES ($1, $2, $3, $4)
			 ON CONFLICT (course_id, slug) DO UPDATE SET idx = EXCLUDED.idx, title = EXCLUDED.title
			 RETURNING id`, courseID, u.Slug, ui, u.Title,
		).Scan(&unitID); err != nil {
			return fmt.Errorf("learn: upsert unit %q: %w", u.Slug, err)
		}
		for li, l := range u.Lessons {
			content, err := json.Marshal(LessonContent{Items: l.Items})
			if err != nil {
				return fmt.Errorf("learn: marshal lesson %q: %w", l.Slug, err)
			}
			xp := l.XP
			if xp <= 0 {
				xp = 10
			}
			if _, err := tx.Exec(ctx,
				`INSERT INTO learn_lessons (unit_id, slug, idx, title, xp, content)
				 VALUES ($1, $2, $3, $4, $5, $6)
				 ON CONFLICT (unit_id, slug) DO UPDATE
				   SET idx = EXCLUDED.idx, title = EXCLUDED.title,
				       xp = EXCLUDED.xp, content = EXCLUDED.content`,
				unitID, l.Slug, li, l.Title, xp, content,
			); err != nil {
				return fmt.Errorf("learn: upsert lesson %q: %w", l.Slug, err)
			}
		}
	}
	return tx.Commit(ctx)
}

// CourseExists : vrai si un cours pour cette langue cible est déjà en base.
// Sert au seed conditionnel au boot.
func (s *Store) CourseExists(ctx context.Context, lang string) (bool, error) {
	var n int
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM learn_courses WHERE lang = $1`, lang).Scan(&n)
	return n > 0, err
}

// ListCourses : cours disponibles (pour l'écran de sélection).
func (s *Store) ListCourses(ctx context.Context) ([]CourseSummary, error) {
	const q = `
		SELECT c.lang, c.title,
		       count(DISTINCT u.id),
		       count(l.id)
		FROM learn_courses c
		LEFT JOIN learn_units u   ON u.course_id = c.id
		LEFT JOIN learn_lessons l ON l.unit_id = u.id
		GROUP BY c.id, c.lang, c.title, c.sort_order
		ORDER BY c.sort_order, c.lang`
	rows, err := s.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("learn: list courses: %w", err)
	}
	defer rows.Close()
	out := []CourseSummary{}
	for rows.Next() {
		var cs CourseSummary
		if err := rows.Scan(&cs.Lang, &cs.Title, &cs.UnitCount, &cs.LessonCount); err != nil {
			return nil, err
		}
		out = append(out, cs)
	}
	return out, rows.Err()
}

// Tree : arbre d'un cours décoré de la progression du user. `userID` peut être
// 0 (non connecté) → tout est verrouillé sauf la première leçon.
func (s *Store) Tree(ctx context.Context, lang string, userID int64) (CourseTree, error) {
	var courseID int64
	var title string
	if err := s.pool.QueryRow(ctx,
		`SELECT id, title FROM learn_courses WHERE lang = $1`, lang,
	).Scan(&courseID, &title); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return CourseTree{}, ErrNotFound
		}
		return CourseTree{}, fmt.Errorf("learn: course: %w", err)
	}

	// Leçons à plat, ordonnées par (unit.idx, lesson.idx) — l'ordre global du
	// parcours qui détermine les verrous.
	const q = `
		SELECT u.slug, u.title, u.idx,
		       l.id, l.slug, l.title, l.xp,
		       COALESCE(jsonb_array_length(l.content->'items'), 0)
		FROM learn_units u
		JOIN learn_lessons l ON l.unit_id = u.id
		WHERE u.course_id = $1
		ORDER BY u.idx, l.idx`
	rows, err := s.pool.Query(ctx, q, courseID)
	if err != nil {
		return CourseTree{}, fmt.Errorf("learn: tree: %w", err)
	}
	defer rows.Close()

	type flat struct {
		unitSlug, unitTitle string
		unitIdx             int
		node                LessonNode
	}
	var lessons []flat
	for rows.Next() {
		var f flat
		if err := rows.Scan(&f.unitSlug, &f.unitTitle, &f.unitIdx,
			&f.node.ID, &f.node.Slug, &f.node.Title, &f.node.XP, &f.node.ItemCount); err != nil {
			return CourseTree{}, err
		}
		lessons = append(lessons, f)
	}
	if err := rows.Err(); err != nil {
		return CourseTree{}, err
	}

	// Progression : map lesson_id -> {stars, placed}. Présence = complété
	// (joué OU placé via le niveau choisi).
	type progRow struct {
		stars  int
		placed bool
	}
	progress := map[int64]progRow{}
	if userID != 0 {
		prows, err := s.pool.Query(ctx,
			`SELECT lesson_id, stars, placed FROM learn_progress WHERE user_id = $1`, userID)
		if err != nil {
			return CourseTree{}, fmt.Errorf("learn: progress: %w", err)
		}
		defer prows.Close()
		for prows.Next() {
			var id int64
			var pr progRow
			if err := prows.Scan(&id, &pr.stars, &pr.placed); err != nil {
				return CourseTree{}, err
			}
			progress[id] = pr
		}
		if err := prows.Err(); err != nil {
			return CourseTree{}, err
		}
	}

	// Verrou : une leçon est ouverte si elle est la première OU si la leçon
	// précédente (ordre global) est complétée (jouée ou placée).
	prevCompleted := true
	for i := range lessons {
		pr, done := progress[lessons[i].node.ID]
		lessons[i].node.Stars = pr.stars
		lessons[i].node.Placed = pr.placed
		lessons[i].node.Completed = done
		lessons[i].node.Locked = !prevCompleted
		prevCompleted = done
	}

	// Regroupe par unité en conservant l'ordre.
	tree := CourseTree{Lang: lang, Title: title}
	idxOf := map[string]int{}
	for _, f := range lessons {
		ui, ok := idxOf[f.unitSlug]
		if !ok {
			ui = len(tree.Units)
			idxOf[f.unitSlug] = ui
			tree.Units = append(tree.Units, UnitNode{Slug: f.unitSlug, Title: f.unitTitle})
		}
		tree.Units[ui].Lessons = append(tree.Units[ui].Lessons, f.node)
	}
	tree.UnitCount = len(tree.Units)

	// Inscription : l'apprenant a-t-il déjà choisi son niveau pour ce cours ?
	if userID != 0 {
		var n int
		if err := s.pool.QueryRow(ctx,
			`SELECT count(*) FROM learn_enrollments WHERE user_id = $1 AND lang = $2`,
			userID, lang,
		).Scan(&n); err != nil {
			return CourseTree{}, fmt.Errorf("learn: enrollment: %w", err)
		}
		tree.Enrolled = n > 0
	}
	return tree, nil
}

// Enroll : inscrit l'apprenant à un cours en mémorisant son niveau de départ.
// Toutes les leçons des unités d'indice < startUnit sont marquées « placées »
// (acquises sans avoir été jouées) afin que le parcours s'ouvre au bon niveau.
// Idempotent : ré-inscrire ne réinitialise pas les leçons déjà jouées.
func (s *Store) Enroll(ctx context.Context, userID int64, lang string, startUnit int) error {
	if startUnit < 0 {
		startUnit = 0
	}
	var courseID int64
	if err := s.pool.QueryRow(ctx,
		`SELECT id FROM learn_courses WHERE lang = $1`, lang,
	).Scan(&courseID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("learn: enroll course: %w", err)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("learn: enroll begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx,
		`INSERT INTO learn_enrollments (user_id, lang, start_unit) VALUES ($1, $2, $3)
		 ON CONFLICT (user_id, lang) DO UPDATE SET start_unit = EXCLUDED.start_unit`,
		userID, lang, startUnit,
	); err != nil {
		return fmt.Errorf("learn: enroll upsert: %w", err)
	}

	// Marque comme « placées » les leçons des unités antérieures au niveau
	// choisi (sans écraser une leçon déjà jouée : placed reste false si déjà
	// complétée pour de vrai).
	if startUnit > 0 {
		if _, err := tx.Exec(ctx,
			`INSERT INTO learn_progress (user_id, lesson_id, stars, times_done, placed)
			 SELECT $1, l.id, 0, 0, true
			 FROM learn_lessons l
			 JOIN learn_units u ON u.id = l.unit_id
			 WHERE u.course_id = $2 AND u.idx < $3
			 ON CONFLICT (user_id, lesson_id) DO NOTHING`,
			userID, courseID, startUnit,
		); err != nil {
			return fmt.Errorf("learn: enroll place: %w", err)
		}
	}
	return tx.Commit(ctx)
}

// LessonForPlay : items d'une leçon résolus dans la langue source `from`.
func (s *Store) LessonForPlay(ctx context.Context, lessonID int64, from string) (LessonPlay, error) {
	var lp LessonPlay
	var raw []byte
	if err := s.pool.QueryRow(ctx,
		`SELECT id, title, xp, content FROM learn_lessons WHERE id = $1`, lessonID,
	).Scan(&lp.ID, &lp.Title, &lp.XP, &raw); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return LessonPlay{}, ErrNotFound
		}
		return LessonPlay{}, fmt.Errorf("learn: lesson: %w", err)
	}
	var content LessonContent
	if err := json.Unmarshal(raw, &content); err != nil {
		return LessonPlay{}, fmt.Errorf("learn: parse content: %w", err)
	}
	for _, it := range content.Items {
		lp.Items = append(lp.Items, PlayItem{Target: it.Target, Meaning: resolveMeaning(it, from)})
	}
	return lp, nil
}

// ---------------------------------------------------------------------------
// État de gamification + streak.
// ---------------------------------------------------------------------------

// regenHearts : régénération paresseuse des cœurs. Renvoie le nombre courant,
// l'horodatage à persister (avancé d'un multiple entier de HeartRegen, pour ne
// pas perdre la fraction de temps écoulée) et le délai avant le prochain cœur.
func regenHearts(hearts int, updatedAt, now time.Time) (cur int, newUpdated time.Time, nextInSec int) {
	if hearts >= MaxHearts {
		return MaxHearts, now, 0
	}
	elapsed := now.Sub(updatedAt)
	regen := int(elapsed / HeartRegen)
	cur = hearts + regen
	newUpdated = updatedAt.Add(time.Duration(regen) * HeartRegen)
	if cur >= MaxHearts {
		return MaxHearts, now, 0
	}
	remain := HeartRegen - now.Sub(newUpdated)
	if remain < 0 {
		remain = 0
	}
	return cur, newUpdated, int(remain.Seconds())
}

// ensureState : crée la ligne d'état si absente.
func ensureState(ctx context.Context, q interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}, userID int64) error {
	_, err := q.Exec(ctx,
		`INSERT INTO learn_state (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, userID)
	return err
}

// State : lecture de l'état courant (cœurs régénérés à la volée, sans écriture).
// `premium` = cœurs illimités (jamais décrémentés, affichés « ∞ »).
func (s *Store) State(ctx context.Context, userID int64, premium bool, now time.Time) (State, error) {
	if err := ensureState(ctx, s.pool, userID); err != nil {
		return State{}, fmt.Errorf("learn: ensure state: %w", err)
	}
	var (
		st            State
		hearts        int
		heartsUpdated time.Time
		lastDay       *time.Time
	)
	if err := s.pool.QueryRow(ctx,
		`SELECT total_xp, daily_goal, hearts, hearts_updated_at,
		        current_streak, longest_streak, last_active_day
		 FROM learn_state WHERE user_id = $1`, userID,
	).Scan(&st.TotalXP, &st.DailyGoal, &hearts, &heartsUpdated,
		&st.CurrentStreak, &st.LongestStreak, &lastDay); err != nil {
		return State{}, fmt.Errorf("learn: read state: %w", err)
	}

	st.MaxHearts = MaxHearts
	st.Premium = premium
	if premium {
		// Cœurs illimités : on affiche le plein, pas de timer de régénération.
		st.UnlimitedHearts = true
		st.Hearts = MaxHearts
		st.NextHeartInSec = 0
	} else {
		st.Hearts, _, st.NextHeartInSec = regenHearts(hearts, heartsUpdated, now)
	}

	// Streak expiré (dernier jour actif < hier) → on l'affiche à 0 sans le
	// réécrire (lazy, comme friends). « At risk » = dernier actif = hier.
	if lastDay != nil {
		gap := daysBetweenUTC(*lastDay, now)
		if gap > 1 {
			st.CurrentStreak = 0
		} else if gap == 1 {
			st.StreakAtRisk = true
		}
	} else {
		st.CurrentStreak = 0
	}

	// XP du jour (objectif quotidien).
	today := now.UTC().Format("2006-01-02")
	if err := s.pool.QueryRow(ctx,
		`SELECT COALESCE(xp, 0) FROM learn_daily WHERE user_id = $1 AND day = $2::date`,
		userID, today,
	).Scan(&st.DailyXP); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return State{}, fmt.Errorf("learn: daily xp: %w", err)
	}

	ach, err := s.achievementCodes(ctx, s.pool, userID)
	if err != nil {
		return State{}, err
	}
	st.Achievements = ach

	// Demande de cœur à un ami : quota 1/jour non consommé ?
	var reqToday int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM learn_heart_requests
		 WHERE requester_id = $1 AND created_at::date = $2::date`,
		userID, today,
	).Scan(&reqToday); err != nil {
		return State{}, fmt.Errorf("learn: heart req count: %w", err)
	}
	st.CanAskHeart = reqToday == 0

	// Demandes de cœur reçues en attente (à accorder).
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM learn_heart_requests
		 WHERE target_id = $1 AND status = 'pending'`, userID,
	).Scan(&st.IncomingHeartRequests); err != nil {
		return State{}, fmt.Errorf("learn: incoming count: %w", err)
	}

	return st, nil
}

// SetDailyGoal : règle l'objectif quotidien (borné).
func (s *Store) SetDailyGoal(ctx context.Context, userID, goal int64) error {
	g := int(goal)
	if g < MinGoal {
		g = MinGoal
	}
	if g > MaxGoal {
		g = MaxGoal
	}
	if err := ensureState(ctx, s.pool, userID); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx,
		`UPDATE learn_state SET daily_goal = $2, updated_at = now() WHERE user_id = $1`,
		userID, g)
	return err
}

type achQuerier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func (s *Store) achievementCodes(ctx context.Context, q achQuerier, userID int64) ([]string, error) {
	rows, err := q.Query(ctx,
		`SELECT code FROM learn_achievements WHERE user_id = $1 ORDER BY unlocked_at`, userID)
	if err != nil {
		return nil, fmt.Errorf("learn: achievements: %w", err)
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// CompleteLesson : valide une leçon. Attribue l'XP, met à jour le streak
// quotidien (cœur du mode Cours), déduit les cœurs perdus, enregistre les
// étoiles, l'XP du jour et débloque les succès franchis. Tout en une
// transaction pour rester cohérent.
//
// `premium` : cœurs illimités → aucune déduction. `failed` : la leçon a été
// abandonnée faute de cœurs → on décompte les cœurs mais on n'attribue ni XP,
// ni progrès, ni streak (cf. interruption style Duolingo).
func (s *Store) CompleteLesson(ctx context.Context, userID, lessonID int64, mistakes int, premium, failed bool, now time.Time) (CompleteResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CompleteResult{}, fmt.Errorf("learn: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// XP de base de la leçon + vérif d'existence.
	var lessonXP int
	if err := tx.QueryRow(ctx,
		`SELECT xp FROM learn_lessons WHERE id = $1`, lessonID,
	).Scan(&lessonXP); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return CompleteResult{}, ErrNotFound
		}
		return CompleteResult{}, fmt.Errorf("learn: lesson xp: %w", err)
	}

	if err := ensureState(ctx, tx, userID); err != nil {
		return CompleteResult{}, fmt.Errorf("learn: ensure state: %w", err)
	}

	var (
		totalXP       int
		dailyGoal     int
		hearts        int
		heartsUpdated time.Time
		currentStreak int
		longestStreak int
		lastDay       *time.Time
		lastMilestone int
	)
	if err := tx.QueryRow(ctx,
		`SELECT total_xp, daily_goal, hearts, hearts_updated_at,
		        current_streak, longest_streak, last_active_day, last_milestone
		 FROM learn_state WHERE user_id = $1 FOR UPDATE`, userID,
	).Scan(&totalXP, &dailyGoal, &hearts, &heartsUpdated,
		&currentStreak, &longestStreak, &lastDay, &lastMilestone); err != nil {
		return CompleteResult{}, fmt.Errorf("learn: lock state: %w", err)
	}

	// Cœurs : régénération paresseuse puis déduction des fautes (plancher 0).
	// Premium = cœurs illimités, aucune déduction.
	curHearts, newHeartsUpdated, _ := regenHearts(hearts, heartsUpdated, now)
	if !premium {
		curHearts -= mistakes
		if curHearts < 0 {
			curHearts = 0
		}
	} else {
		curHearts = hearts
		newHeartsUpdated = heartsUpdated
	}

	// Échec (plus de cœurs en cours de leçon) : on persiste la perte de cœurs
	// mais on n'attribue ni XP, ni progrès, ni streak. Premium ne peut pas
	// échouer (cœurs illimités) → on ignore le flag.
	if failed && !premium {
		if _, err := tx.Exec(ctx,
			`UPDATE learn_state SET hearts = $2, hearts_updated_at = $3, updated_at = now()
			 WHERE user_id = $1`,
			userID, curHearts, newHeartsUpdated,
		); err != nil {
			return CompleteResult{}, fmt.Errorf("learn: update hearts (fail): %w", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return CompleteResult{}, fmt.Errorf("learn: commit (fail): %w", err)
		}
		st, err := s.State(ctx, userID, premium, now)
		if err != nil {
			return CompleteResult{}, err
		}
		return CompleteResult{Failed: true, State: st}, nil
	}

	// Étoiles + reprise (XP réduit si la leçon a déjà été complétée).
	stars := starsFromMistakes(mistakes)
	var alreadyStars int
	var alreadyDone bool
	if err := tx.QueryRow(ctx,
		`SELECT stars, true FROM learn_progress WHERE user_id = $1 AND lesson_id = $2 AND placed = false`,
		userID, lessonID,
	).Scan(&alreadyStars, &alreadyDone); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return CompleteResult{}, fmt.Errorf("learn: read progress: %w", err)
	}
	xpAward := lessonXP
	if alreadyDone {
		xpAward = ReviewXPMax
	}

	// Streak quotidien.
	today := now.UTC()
	todayStr := today.Format("2006-01-02")
	streakIncreased := false
	streakReset := false
	newStreak := currentStreak
	if lastDay == nil {
		newStreak = 1
		streakIncreased = true
	} else {
		switch daysBetweenUTC(*lastDay, now) {
		case 0:
			// Déjà actif aujourd'hui → streak inchangé.
		case 1:
			newStreak = currentStreak + 1
			streakIncreased = true
		default:
			newStreak = 1
			streakIncreased = true
			streakReset = true
		}
	}
	if newStreak > longestStreak {
		longestStreak = newStreak
	}

	// Palier de streak franchi (strictement au-dessus du dernier notifié).
	// Après une série cassée on repart de zéro pour permettre de re-célébrer
	// les paliers de la nouvelle série.
	baseMilestone := lastMilestone
	if streakReset {
		baseMilestone = 0
	}
	newMilestone := 0
	for _, m := range StreakMilestones {
		if newStreak >= m && m > baseMilestone {
			newMilestone = m
		}
	}
	persistedMilestone := baseMilestone
	if newMilestone > 0 {
		persistedMilestone = newMilestone
	}

	totalXP += xpAward

	if _, err := tx.Exec(ctx,
		`UPDATE learn_state
		 SET total_xp = $2, hearts = $3, hearts_updated_at = $4,
		     current_streak = $5, longest_streak = $6, last_active_day = $7::date,
		     last_milestone = $8, updated_at = now()
		 WHERE user_id = $1`,
		userID, totalXP, curHearts, newHeartsUpdated,
		newStreak, longestStreak, todayStr, persistedMilestone,
	); err != nil {
		return CompleteResult{}, fmt.Errorf("learn: update state: %w", err)
	}

	// Progression de la leçon : on garde le meilleur score d'étoiles. Jouer une
	// leçon « placée » la convertit en leçon réellement complétée (placed=false).
	if _, err := tx.Exec(ctx,
		`INSERT INTO learn_progress (user_id, lesson_id, stars, times_done, placed, completed_at)
		 VALUES ($1, $2, $3, 1, false, now())
		 ON CONFLICT (user_id, lesson_id) DO UPDATE
		   SET stars = GREATEST(learn_progress.stars, EXCLUDED.stars),
		       times_done = learn_progress.times_done + 1,
		       placed = false,
		       completed_at = now()`,
		userID, lessonID, stars,
	); err != nil {
		return CompleteResult{}, fmt.Errorf("learn: upsert progress: %w", err)
	}

	// XP du jour (objectif quotidien + streak).
	if _, err := tx.Exec(ctx,
		`INSERT INTO learn_daily (user_id, day, xp) VALUES ($1, $2::date, $3)
		 ON CONFLICT (user_id, day) DO UPDATE SET xp = learn_daily.xp + EXCLUDED.xp`,
		userID, todayStr, xpAward,
	); err != nil {
		return CompleteResult{}, fmt.Errorf("learn: daily xp: %w", err)
	}

	// Nombre de leçons réellement jouées (placées exclues) — pour les succès
	// "lessons", afin qu'un choix de niveau élevé ne les débloque pas d'office.
	var lessonsDone int
	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM learn_progress WHERE user_id = $1 AND placed = false`, userID,
	).Scan(&lessonsDone); err != nil {
		return CompleteResult{}, fmt.Errorf("learn: count lessons: %w", err)
	}

	// Succès franchis.
	newAch := []string{}
	for _, def := range Achievements {
		ok := false
		switch def.Kind {
		case KindFirstLesson:
			ok = lessonsDone >= def.Threshold
		case KindXP:
			ok = totalXP >= def.Threshold
		case KindStreak:
			ok = newStreak >= def.Threshold
		}
		if !ok {
			continue
		}
		tag, err := tx.Exec(ctx,
			`INSERT INTO learn_achievements (user_id, code) VALUES ($1, $2)
			 ON CONFLICT (user_id, code) DO NOTHING`, userID, def.Code)
		if err != nil {
			return CompleteResult{}, fmt.Errorf("learn: insert achievement: %w", err)
		}
		if tag.RowsAffected() > 0 {
			newAch = append(newAch, def.Code)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return CompleteResult{}, fmt.Errorf("learn: commit: %w", err)
	}

	// État final reconstitué (post-commit, lecture simple).
	st, err := s.State(ctx, userID, premium, now)
	if err != nil {
		return CompleteResult{}, err
	}
	return CompleteResult{
		XPAwarded:          xpAward,
		Stars:              stars,
		State:              st,
		NewAchievements:    newAch,
		StreakIncreased:    streakIncreased,
		NewStreakMilestone: newMilestone,
	}, nil
}

// ---------------------------------------------------------------------------
// Demandes de cœur entre amis (1/jour côté demandeur).
// ---------------------------------------------------------------------------

// CreateHeartRequest : crée une demande de cœur en attente vers `targetID`.
// errCode "quota" si l'apprenant a déjà demandé un cœur aujourd'hui.
func (s *Store) CreateHeartRequest(ctx context.Context, requesterID, targetID int64, now time.Time) (int64, string, error) {
	today := now.UTC().Format("2006-01-02")
	var cnt int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM learn_heart_requests
		 WHERE requester_id = $1 AND created_at::date = $2::date`,
		requesterID, today,
	).Scan(&cnt); err != nil {
		return 0, "", fmt.Errorf("learn: heart req quota: %w", err)
	}
	if cnt > 0 {
		return 0, "quota", nil
	}
	var id int64
	if err := s.pool.QueryRow(ctx,
		`INSERT INTO learn_heart_requests (requester_id, target_id) VALUES ($1, $2)
		 RETURNING id`, requesterID, targetID,
	).Scan(&id); err != nil {
		return 0, "", fmt.Errorf("learn: heart req insert: %w", err)
	}
	return id, "", nil
}

// ListIncomingHeartRequests : demandes en attente reçues par `userID`.
func (s *Store) ListIncomingHeartRequests(ctx context.Context, userID int64) ([]HeartRequest, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, requester_id, created_at FROM learn_heart_requests
		 WHERE target_id = $1 AND status = 'pending'
		 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("learn: incoming reqs: %w", err)
	}
	defer rows.Close()
	out := []HeartRequest{}
	for rows.Next() {
		var hr HeartRequest
		var created time.Time
		if err := rows.Scan(&hr.ID, &hr.RequesterID, &created); err != nil {
			return nil, err
		}
		hr.CreatedAt = created.Format(time.RFC3339)
		out = append(out, hr)
	}
	return out, rows.Err()
}

// GrantHeart : `targetID` accorde la demande `requestID` → +1 cœur au
// demandeur (plafonné). Renvoie l'ID du demandeur et true si accordé. false si
// la demande n'existe pas / déjà résolue / pas adressée à ce user.
func (s *Store) GrantHeart(ctx context.Context, targetID, requestID int64, now time.Time) (int64, bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, false, fmt.Errorf("learn: grant begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var requesterID int64
	if err := tx.QueryRow(ctx,
		`SELECT requester_id FROM learn_heart_requests
		 WHERE id = $1 AND target_id = $2 AND status = 'pending' FOR UPDATE`,
		requestID, targetID,
	).Scan(&requesterID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, false, nil
		}
		return 0, false, fmt.Errorf("learn: grant load: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`UPDATE learn_heart_requests SET status = 'granted', resolved_at = now() WHERE id = $1`,
		requestID,
	); err != nil {
		return 0, false, fmt.Errorf("learn: grant mark: %w", err)
	}

	if err := ensureState(ctx, tx, requesterID); err != nil {
		return 0, false, fmt.Errorf("learn: grant ensure: %w", err)
	}
	var hearts int
	var hu time.Time
	if err := tx.QueryRow(ctx,
		`SELECT hearts, hearts_updated_at FROM learn_state WHERE user_id = $1 FOR UPDATE`,
		requesterID,
	).Scan(&hearts, &hu); err != nil {
		return 0, false, fmt.Errorf("learn: grant read: %w", err)
	}
	cur, newHu, _ := regenHearts(hearts, hu, now)
	cur = min(cur+1, MaxHearts)
	if _, err := tx.Exec(ctx,
		`UPDATE learn_state SET hearts = $2, hearts_updated_at = $3, updated_at = now()
		 WHERE user_id = $1`, requesterID, cur, newHu,
	); err != nil {
		return 0, false, fmt.Errorf("learn: grant apply: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, false, fmt.Errorf("learn: grant commit: %w", err)
	}
	return requesterID, true, nil
}

// daysBetweenUTC : nombre de jours calendaires UTC entre d et now.
func daysBetweenUTC(d, now time.Time) int {
	a := time.Date(d.UTC().Year(), d.UTC().Month(), d.UTC().Day(), 0, 0, 0, 0, time.UTC)
	b := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)
	return int(b.Sub(a).Hours() / 24)
}
