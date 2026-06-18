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

	// Progression : map lesson_id -> stars (présence = complété).
	progress := map[int64]int{}
	if userID != 0 {
		prows, err := s.pool.Query(ctx,
			`SELECT lesson_id, stars FROM learn_progress WHERE user_id = $1`, userID)
		if err != nil {
			return CourseTree{}, fmt.Errorf("learn: progress: %w", err)
		}
		defer prows.Close()
		for prows.Next() {
			var id int64
			var stars int
			if err := prows.Scan(&id, &stars); err != nil {
				return CourseTree{}, err
			}
			progress[id] = stars
		}
		if err := prows.Err(); err != nil {
			return CourseTree{}, err
		}
	}

	// Verrou : une leçon est ouverte si elle est la première OU si la leçon
	// précédente (ordre global) est complétée.
	prevCompleted := true
	for i := range lessons {
		stars, done := progress[lessons[i].node.ID]
		lessons[i].node.Stars = stars
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
	return tree, nil
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
func (s *Store) State(ctx context.Context, userID int64, now time.Time) (State, error) {
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

	st.Hearts, _, st.NextHeartInSec = regenHearts(hearts, heartsUpdated, now)
	st.MaxHearts = MaxHearts

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
func (s *Store) CompleteLesson(ctx context.Context, userID, lessonID int64, mistakes int, now time.Time) (CompleteResult, error) {
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

	// Étoiles + reprise (XP réduit si la leçon a déjà été complétée).
	stars := starsFromMistakes(mistakes)
	var alreadyStars int
	var alreadyDone bool
	if err := tx.QueryRow(ctx,
		`SELECT stars, true FROM learn_progress WHERE user_id = $1 AND lesson_id = $2`,
		userID, lessonID,
	).Scan(&alreadyStars, &alreadyDone); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return CompleteResult{}, fmt.Errorf("learn: read progress: %w", err)
	}
	xpAward := lessonXP
	if alreadyDone {
		xpAward = ReviewXPMax
	}

	// Cœurs : régénération paresseuse puis déduction des fautes (plancher 0).
	curHearts, newHeartsUpdated, _ := regenHearts(hearts, heartsUpdated, now)
	curHearts -= mistakes
	if curHearts < 0 {
		curHearts = 0
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

	// Progression de la leçon : on garde le meilleur score d'étoiles.
	if _, err := tx.Exec(ctx,
		`INSERT INTO learn_progress (user_id, lesson_id, stars, times_done, completed_at)
		 VALUES ($1, $2, $3, 1, now())
		 ON CONFLICT (user_id, lesson_id) DO UPDATE
		   SET stars = GREATEST(learn_progress.stars, EXCLUDED.stars),
		       times_done = learn_progress.times_done + 1,
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

	// Nombre de leçons distinctes complétées (pour les succès "lessons").
	var lessonsDone int
	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM learn_progress WHERE user_id = $1`, userID,
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
	st, err := s.State(ctx, userID, now)
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

// daysBetweenUTC : nombre de jours calendaires UTC entre d et now.
func daysBetweenUTC(d, now time.Time) int {
	a := time.Date(d.UTC().Year(), d.UTC().Month(), d.UTC().Day(), 0, 0, 0, 0, time.UTC)
	b := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)
	return int(b.Sub(a).Hours() / 24)
}
