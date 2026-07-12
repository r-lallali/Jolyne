package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// stats_store.go : agrégations en LECTURE seule pour les dashboards /admin.
// Source : la table `events` (cf. internal/analytics) + jointures users/bans.
// Tout est SQL pur sur s.pool — aucun état, aucun cache.

// ---------------------------------------------------------------------------
// Overview — cartes KPI de la page d'accueil du back-office.
// ---------------------------------------------------------------------------

// Overview agrège les KPIs persistés. Les champs « live » (OnlineNow,
// Searching, QueueDepth) sont remplis par le handler à partir du Hub/Redis.
type Overview struct {
	TotalUsers       int64        `json:"total_users"`
	NewUsers24h      int64        `json:"new_users_24h"`
	NewUsers7d       int64        `json:"new_users_7d"`
	DAU              int64        `json:"dau"`
	WAU              int64        `json:"wau"`
	MAU              int64        `json:"mau"`
	PremiumUsers     int64        `json:"premium_users"`
	Conversations24h int64        `json:"conversations_24h"`
	HumanMatches24h  int64        `json:"human_matches_24h"`
	BotMatches24h    int64        `json:"bot_matches_24h"`
	OnlineNow        int          `json:"online_now"`
	Searching        int          `json:"searching"`
	QueueDepth       []QueueDepth `json:"queue_depth"`
}

// QueueDepth : profondeur de la file Redis pour une paire de langues.
type QueueDepth struct {
	Pair  string `json:"pair"`
	Count int64  `json:"count"`
}

func (s *Store) Overview(ctx context.Context) (Overview, error) {
	var o Overview
	const q = `
		SELECT
		  (SELECT count(*) FROM users),
		  (SELECT count(*) FROM users WHERE created_at > now() - interval '24 hours'),
		  (SELECT count(*) FROM users WHERE created_at > now() - interval '7 days'),
		  (SELECT count(DISTINCT user_id) FROM events WHERE user_id IS NOT NULL AND ts > now() - interval '24 hours'),
		  (SELECT count(DISTINCT user_id) FROM events WHERE user_id IS NOT NULL AND ts > now() - interval '7 days'),
		  (SELECT count(DISTINCT user_id) FROM events WHERE user_id IS NOT NULL AND ts > now() - interval '30 days'),
		  (SELECT count(*) FROM users WHERE plan = 'premium'),
		  (SELECT count(*) FROM events WHERE name = 'match_found' AND ts > now() - interval '24 hours'),
		  (SELECT count(*) FROM events WHERE name = 'match_found' AND props->>'peer' = 'human' AND ts > now() - interval '24 hours'),
		  (SELECT count(*) FROM events WHERE name = 'match_found' AND props->>'peer' = 'bot' AND ts > now() - interval '24 hours')`
	err := s.pool.QueryRow(ctx, q).Scan(
		&o.TotalUsers, &o.NewUsers24h, &o.NewUsers7d,
		&o.DAU, &o.WAU, &o.MAU, &o.PremiumUsers,
		&o.Conversations24h, &o.HumanMatches24h, &o.BotMatches24h,
	)
	if err != nil {
		return Overview{}, fmt.Errorf("admin: overview: %w", err)
	}
	o.QueueDepth = []QueueDepth{}
	return o, nil
}

// ---------------------------------------------------------------------------
// Funnel — comptage par étage sur une plage de dates.
// ---------------------------------------------------------------------------

// FunnelStage : un étage du funnel. DropPct est calculé côté handler.
type FunnelStage struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Count int64  `json:"count"`
}

func (s *Store) Funnel(ctx context.Context, from, to time.Time) ([]FunnelStage, error) {
	const q = `
		SELECT
		  count(DISTINCT anon_id) FILTER (WHERE name = 'page_view'),
		  count(DISTINCT anon_id) FILTER (WHERE name = 'signup_started'),
		  count(DISTINCT user_id) FILTER (WHERE name = 'signup_completed'),
		  count(DISTINCT user_id) FILTER (WHERE name = 'email_verified'),
		  count(DISTINCT user_id) FILTER (WHERE name = 'match_found'),
		  count(DISTINCT user_id) FILTER (WHERE name = 'message_sent'),
		  count(DISTINCT user_id) FILTER (WHERE name = 'premium_activated')
		FROM events
		WHERE ts >= $1 AND ts < $2`
	var visitors, started, signups, verified, matched, messaged, premium int64
	if err := s.pool.QueryRow(ctx, q, from, to).Scan(
		&visitors, &started, &signups, &verified, &matched, &messaged, &premium,
	); err != nil {
		return nil, fmt.Errorf("admin: funnel: %w", err)
	}
	return []FunnelStage{
		{"page_view", "Visiteurs", visitors},
		{"signup_started", "Inscription entamée", started},
		{"signup_completed", "Compte créé", signups},
		{"email_verified", "Email vérifié", verified},
		{"match_found", "1er match", matched},
		{"message_sent", "1er message", messaged},
		{"premium_activated", "Premium", premium},
	}, nil
}

// ---------------------------------------------------------------------------
// Retention — cohortes (quotidiennes ou hebdomadaires).
// ---------------------------------------------------------------------------

// RetentionRow : une cohorte. Size = inscrits ; Values[offset] = actifs à
// l'offset (en périodes après l'inscription).
type RetentionRow struct {
	Cohort string          `json:"cohort"`
	Size   int64           `json:"size"`
	Values map[int]int64   `json:"values"`
	Rates  map[int]float64 `json:"rates"`
}

// Retention renvoie les cohortes depuis `since`. unit ∈ {day, week}.
func (s *Store) Retention(ctx context.Context, unit string, since time.Time) ([]RetentionRow, error) {
	divisor := 86400.0 // jour
	if unit == "week" {
		divisor = 604800.0
	} else {
		unit = "day"
	}

	// Tailles de cohorte (tous les inscrits, même inactifs ensuite).
	sizes := map[string]int64{}
	var order []string
	rowsSz, err := s.pool.Query(ctx, `
		SELECT date_trunc($1, created_at) AS cohort, count(*)
		FROM users WHERE created_at >= $2
		GROUP BY 1 ORDER BY 1`, unit, since)
	if err != nil {
		return nil, fmt.Errorf("admin: retention sizes: %w", err)
	}
	defer rowsSz.Close()
	for rowsSz.Next() {
		var c time.Time
		var n int64
		if err := rowsSz.Scan(&c, &n); err != nil {
			return nil, fmt.Errorf("admin: scan cohort size: %w", err)
		}
		key := c.Format("2006-01-02")
		sizes[key] = n
		order = append(order, key)
	}
	if err := rowsSz.Err(); err != nil {
		return nil, err
	}

	// Activité par offset.
	type cell struct {
		offset int
		users  int64
	}
	rows, err := s.pool.Query(ctx, `
		WITH cohort AS (
		  SELECT u.id AS user_id, date_trunc($1, u.created_at) AS cohort_period
		  FROM users u WHERE u.created_at >= $2
		),
		activity AS (
		  SELECT DISTINCT e.user_id, date_trunc($1, e.ts) AS active_period
		  FROM events e WHERE e.user_id IS NOT NULL AND e.ts >= $2
		)
		SELECT c.cohort_period,
		       round(extract(epoch FROM (a.active_period - c.cohort_period)) / $3)::int AS period_offset,
		       count(DISTINCT c.user_id)
		FROM cohort c
		JOIN activity a ON a.user_id = c.user_id AND a.active_period >= c.cohort_period
		GROUP BY 1, 2 ORDER BY 1, 2`, unit, since, divisor)
	if err != nil {
		return nil, fmt.Errorf("admin: retention activity: %w", err)
	}
	defer rows.Close()

	byCohort := map[string]map[int]int64{}
	for rows.Next() {
		var c time.Time
		var cl cell
		if err := rows.Scan(&c, &cl.offset, &cl.users); err != nil {
			return nil, fmt.Errorf("admin: scan retention: %w", err)
		}
		key := c.Format("2006-01-02")
		if byCohort[key] == nil {
			byCohort[key] = map[int]int64{}
		}
		byCohort[key][cl.offset] = cl.users
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := []RetentionRow{}
	for _, key := range order {
		size := sizes[key]
		vals := byCohort[key]
		if vals == nil {
			vals = map[int]int64{}
		}
		rates := map[int]float64{}
		for off, n := range vals {
			if size > 0 {
				rates[off] = float64(n) / float64(size)
			}
		}
		out = append(out, RetentionRow{Cohort: key, Size: size, Values: vals, Rates: rates})
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// TimeSeries — série générique pour les graphiques.
// ---------------------------------------------------------------------------

// TimePoint : un point d'une série temporelle.
type TimePoint struct {
	Bucket time.Time `json:"bucket"`
	Value  int64     `json:"value"`
}

// metricExpr mappe un nom de métrique (validé) vers son expression SQL. Évite
// toute injection : seules ces clés sont acceptées.
var metricExpr = map[string]string{
	"page_views":   "count(DISTINCT anon_id) FILTER (WHERE name = 'page_view')",
	"signups":      "count(*) FILTER (WHERE name = 'signup_completed')",
	"active_users": "count(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL)",
	"matches":      "count(*) FILTER (WHERE name = 'match_found')",
	"messages":     "count(*) FILTER (WHERE name = 'message_sent')",
	"premium":      "count(*) FILTER (WHERE name = 'premium_activated')",
}

var intervalAllowed = map[string]struct{}{"hour": {}, "day": {}, "week": {}}

func (s *Store) TimeSeries(ctx context.Context, metric, interval string, from, to time.Time) ([]TimePoint, error) {
	expr, ok := metricExpr[metric]
	if !ok {
		return nil, fmt.Errorf("admin: métrique inconnue: %s", metric)
	}
	if _, ok := intervalAllowed[interval]; !ok {
		interval = "day"
	}
	// interval et expr proviennent d'allowlists internes — pas de paramètre
	// utilisateur interpolé directement.
	q := fmt.Sprintf(`
		SELECT date_trunc($1, ts) AS bucket, %s AS value
		FROM events WHERE ts >= $2 AND ts < $3
		GROUP BY 1 ORDER BY 1`, expr)
	rows, err := s.pool.Query(ctx, q, interval, from, to)
	if err != nil {
		return nil, fmt.Errorf("admin: timeseries: %w", err)
	}
	defer rows.Close()
	out := []TimePoint{}
	for rows.Next() {
		var p TimePoint
		if err := rows.Scan(&p.Bucket, &p.Value); err != nil {
			return nil, fmt.Errorf("admin: scan timeseries: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Engagement — qualité des conversations.
// ---------------------------------------------------------------------------

type LangPair struct {
	Pair  string `json:"pair"`
	Count int64  `json:"count"`
}

type Engagement struct {
	Matches        int64      `json:"matches"`
	BotMatches     int64      `json:"bot_matches"`
	Messages       int64      `json:"messages"`
	Conversations  int64      `json:"conversations_ended"`
	AvgDurationSec float64    `json:"avg_duration_sec"`
	BotFallbackPct float64    `json:"bot_fallback_pct"`
	LangPairs      []LangPair `json:"lang_pairs"`
}

func (s *Store) Engagement(ctx context.Context, from, to time.Time) (Engagement, error) {
	var e Engagement
	const q = `
		SELECT
		  count(*) FILTER (WHERE name = 'match_found'),
		  count(*) FILTER (WHERE name = 'match_found' AND props->>'peer' = 'bot'),
		  count(*) FILTER (WHERE name = 'message_sent'),
		  count(*) FILTER (WHERE name = 'conversation_ended'),
		  COALESCE(avg(NULLIF(props->>'duration_s','')::numeric) FILTER (WHERE name = 'conversation_ended'), 0)
		FROM events WHERE ts >= $1 AND ts < $2`
	if err := s.pool.QueryRow(ctx, q, from, to).Scan(
		&e.Matches, &e.BotMatches, &e.Messages, &e.Conversations, &e.AvgDurationSec,
	); err != nil {
		return Engagement{}, fmt.Errorf("admin: engagement: %w", err)
	}
	if e.Matches > 0 {
		e.BotFallbackPct = float64(e.BotMatches) / float64(e.Matches)
	}

	rows, err := s.pool.Query(ctx, `
		SELECT COALESCE(lang_from,'?')||'→'||COALESCE(lang_to,'?') AS pair, count(*)
		FROM events WHERE name = 'match_found' AND ts >= $1 AND ts < $2
		GROUP BY 1 ORDER BY 2 DESC LIMIT 12`, from, to)
	if err != nil {
		return Engagement{}, fmt.Errorf("admin: lang pairs: %w", err)
	}
	defer rows.Close()
	e.LangPairs = []LangPair{}
	for rows.Next() {
		var lp LangPair
		if err := rows.Scan(&lp.Pair, &lp.Count); err != nil {
			return Engagement{}, fmt.Errorf("admin: scan lang pair: %w", err)
		}
		e.LangPairs = append(e.LangPairs, lp)
	}
	return e, rows.Err()
}

// ---------------------------------------------------------------------------
// Revenue — premium / churn / MRR.
// ---------------------------------------------------------------------------

type Revenue struct {
	Activations    int64   `json:"activations"`
	Cancellations  int64   `json:"cancellations"`
	ActivePremium  int64   `json:"active_premium"`
	SignupsInRange int64   `json:"signups_in_range"`
	ConversionPct  float64 `json:"conversion_pct"`
	MRRCents       int64   `json:"mrr_cents"`
}

func (s *Store) Revenue(ctx context.Context, from, to time.Time, monthlyCents int64) (Revenue, error) {
	var r Revenue
	const q = `
		SELECT
		  count(*) FILTER (WHERE name = 'premium_activated'),
		  count(*) FILTER (WHERE name = 'premium_canceled'),
		  (SELECT count(*) FROM users WHERE plan = 'premium'),
		  (SELECT count(*) FROM users WHERE created_at >= $1 AND created_at < $2)
		FROM events WHERE ts >= $1 AND ts < $2`
	if err := s.pool.QueryRow(ctx, q, from, to).Scan(
		&r.Activations, &r.Cancellations, &r.ActivePremium, &r.SignupsInRange,
	); err != nil {
		return Revenue{}, fmt.Errorf("admin: revenue: %w", err)
	}
	if r.SignupsInRange > 0 {
		r.ConversionPct = float64(r.Activations) / float64(r.SignupsInRange)
	}
	r.MRRCents = r.ActivePremium * monthlyCents
	return r, nil
}

// ---------------------------------------------------------------------------
// Users — recherche, fiche, actions (premium / RGPD).
// ---------------------------------------------------------------------------

type UserRow struct {
	ID         int64      `json:"id"`
	Email      string     `json:"email"`
	Plan       string     `json:"plan"`
	Verified   bool       `json:"verified"`
	CreatedAt  time.Time  `json:"created_at"`
	LastSeenAt *time.Time `json:"last_seen_at,omitempty"`
}

func (s *Store) SearchUsers(ctx context.Context, q string, limit, offset int) ([]UserRow, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	const sql = `
		SELECT id, email, plan, (email_verified_at IS NOT NULL), created_at, last_seen_at
		FROM users
		WHERE ($1 = '' OR email ILIKE '%'||$1||'%' OR CAST(id AS TEXT) = $1)
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3`
	rows, err := s.pool.Query(ctx, sql, q, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("admin: search users: %w", err)
	}
	defer rows.Close()
	out := []UserRow{}
	for rows.Next() {
		var u UserRow
		if err := rows.Scan(&u.ID, &u.Email, &u.Plan, &u.Verified, &u.CreatedAt, &u.LastSeenAt); err != nil {
			return nil, fmt.Errorf("admin: scan user: %w", err)
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

type UserDetail struct {
	UserRow
	SubscriptionStatus string     `json:"subscription_status,omitempty"`
	CurrentPeriodEnd   *time.Time `json:"current_period_end,omitempty"`
	HasStripeCustomer  bool       `json:"has_stripe_customer"`
	TotalEvents        int64      `json:"total_events"`
	Conversations      int64      `json:"conversations"`
	Messages           int64      `json:"messages"`
	FirstSeen          *time.Time `json:"first_seen,omitempty"`
	LastEvent          *time.Time `json:"last_event,omitempty"`
	Banned             bool       `json:"banned"`
}

func (s *Store) UserDetail(ctx context.Context, id int64) (UserDetail, error) {
	var d UserDetail
	const uq = `
		SELECT id, email, plan, (email_verified_at IS NOT NULL), created_at, last_seen_at,
		       COALESCE(subscription_status,''), current_period_end, (stripe_customer_id IS NOT NULL)
		FROM users WHERE id = $1`
	err := s.pool.QueryRow(ctx, uq, id).Scan(
		&d.ID, &d.Email, &d.Plan, &d.Verified, &d.CreatedAt, &d.LastSeenAt,
		&d.SubscriptionStatus, &d.CurrentPeriodEnd, &d.HasStripeCustomer,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return UserDetail{}, fmt.Errorf("admin: user %d introuvable", id)
		}
		return UserDetail{}, fmt.Errorf("admin: user detail: %w", err)
	}

	const eq = `
		SELECT count(*),
		       count(*) FILTER (WHERE name = 'match_found'),
		       count(*) FILTER (WHERE name = 'message_sent'),
		       min(ts), max(ts)
		FROM events WHERE user_id = $1`
	if err := s.pool.QueryRow(ctx, eq, id).Scan(
		&d.TotalEvents, &d.Conversations, &d.Messages, &d.FirstSeen, &d.LastEvent,
	); err != nil {
		return UserDetail{}, fmt.Errorf("admin: user events: %w", err)
	}

	const bq = `
		SELECT count(*) > 0 FROM bans
		WHERE target_type = 'user' AND target_value = $1
		  AND (expires_at IS NULL OR expires_at > now())`
	if err := s.pool.QueryRow(ctx, bq, fmt.Sprintf("%d", id)).Scan(&d.Banned); err != nil {
		return UserDetail{}, fmt.Errorf("admin: user ban status: %w", err)
	}
	return d, nil
}

// SetPlan force le plan d'un utilisateur (geste admin : offrir/retirer Premium).
// Stripe reste la source de vérité des abonnements payants ; ce override est
// tracé dans audit_log (subscription_status = 'admin_grant').
func (s *Store) SetPlan(ctx context.Context, id int64, premium bool, by, ipHash string) error {
	plan, status := "free", ""
	if premium {
		plan, status = "premium", "admin_grant"
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("admin: tx begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	res, err := tx.Exec(ctx, `
		UPDATE users SET plan = $1, subscription_status = NULLIF($2,'')
		WHERE id = $3`, plan, status, id)
	if err != nil {
		return fmt.Errorf("admin: set plan: %w", err)
	}
	if res.RowsAffected() == 0 {
		return fmt.Errorf("admin: user %d introuvable", id)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_log (actor, action, target_type, target_value, reason, ip_hash)
		VALUES ($1, $2, 'user', $3, NULL, $4)`,
		by, "plan_"+plan, fmt.Sprintf("%d", id), ipHash); err != nil {
		return fmt.Errorf("admin: audit set plan: %w", err)
	}
	return tx.Commit(ctx)
}

// ExportUser renvoie toutes les données d'un utilisateur (RGPD, droit d'accès).
func (s *Store) ExportUser(ctx context.Context, id int64) (map[string]any, error) {
	out := map[string]any{}

	var (
		email      string
		plan       string
		createdAt  time.Time
		lastSeen   *time.Time
		verifiedAt *time.Time
	)
	err := s.pool.QueryRow(ctx, `
		SELECT email, plan, created_at, last_seen_at, email_verified_at
		FROM users WHERE id = $1`, id).Scan(&email, &plan, &createdAt, &lastSeen, &verifiedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("admin: user %d introuvable", id)
		}
		return nil, fmt.Errorf("admin: export user: %w", err)
	}
	out["user"] = map[string]any{
		"id": id, "email": email, "plan": plan,
		"created_at": createdAt, "last_seen_at": lastSeen, "email_verified_at": verifiedAt,
	}

	rows, err := s.pool.Query(ctx, `
		SELECT ts, name, lang_from, lang_to, props
		FROM events WHERE user_id = $1 ORDER BY ts`, id)
	if err != nil {
		return nil, fmt.Errorf("admin: export events: %w", err)
	}
	defer rows.Close()
	events := []map[string]any{}
	for rows.Next() {
		var (
			ts       time.Time
			name     string
			lf, lt   *string
			rawProps []byte
		)
		if err := rows.Scan(&ts, &name, &lf, &lt, &rawProps); err != nil {
			return nil, fmt.Errorf("admin: scan export event: %w", err)
		}
		ev := map[string]any{"ts": ts, "name": name}
		if lf != nil {
			ev["lang_from"] = *lf
		}
		if lt != nil {
			ev["lang_to"] = *lt
		}
		if len(rawProps) > 0 {
			var p any
			if json.Unmarshal(rawProps, &p) == nil {
				ev["props"] = p
			}
		}
		events = append(events, ev)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out["events"] = events
	return out, nil
}

// DeleteUser supprime un compte et toutes ses données (RGPD, droit à l'oubli).
// Le ON DELETE CASCADE sur events/auth_tokens/etc. nettoie les tables liées.
func (s *Store) DeleteUser(ctx context.Context, id int64, by, ipHash string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("admin: tx begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Audit AVANT suppression : on ne pourra plus référencer l'email après.
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_log (actor, action, target_type, target_value, reason, ip_hash)
		VALUES ($1, 'user_deleted', 'user', $2, 'RGPD', $3)`,
		by, fmt.Sprintf("%d", id), ipHash); err != nil {
		return fmt.Errorf("admin: audit delete: %w", err)
	}
	res, err := tx.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("admin: delete user: %w", err)
	}
	if res.RowsAffected() == 0 {
		return fmt.Errorf("admin: user %d introuvable", id)
	}
	return tx.Commit(ctx)
}

// ---------------------------------------------------------------------------
// Audit log — visualiseur de la table audit_log (déjà peuplée par bans/reports).
// ---------------------------------------------------------------------------

type AuditEntry struct {
	Actor       string    `json:"actor"`
	Action      string    `json:"action"`
	TargetType  string    `json:"target_type"`
	TargetValue string    `json:"target_value"`
	Reason      string    `json:"reason,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

func (s *Store) AuditLog(ctx context.Context, limit, offset int) ([]AuditEntry, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := s.pool.Query(ctx, `
		SELECT actor, action, target_type, COALESCE(target_value,''), COALESCE(reason,''), created_at
		FROM audit_log ORDER BY created_at DESC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("admin: audit log: %w", err)
	}
	defer rows.Close()
	out := []AuditEntry{}
	for rows.Next() {
		var a AuditEntry
		if err := rows.Scan(&a.Actor, &a.Action, &a.TargetType, &a.TargetValue, &a.Reason, &a.CreatedAt); err != nil {
			return nil, fmt.Errorf("admin: scan audit: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
