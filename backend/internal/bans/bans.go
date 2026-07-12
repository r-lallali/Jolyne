// Package bans gère l'émission, le check et la levée des bannissements
// multi-axes (IP hashée, fingerprint, futur userId). Voir CLAUDE.md §Sécurité.
package bans

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type TargetType string

const (
	TargetIP          TargetType = "ip"
	TargetFingerprint TargetType = "fingerprint"
	TargetUser        TargetType = "user"
)

// Ban est une ligne de la table `bans`. ExpiresAt nil = permanent.
type Ban struct {
	ID              int64
	TargetType      TargetType
	TargetValue     string
	Reason          string
	BannedBy        string
	ExpiresAt       *time.Time
	CreatedAt       time.Time
	RelatedReportID *int64
}

// Issue regroupe les paramètres pour bannir une personne sur 1+ axes.
// Au moins un de IPHash / Fingerprint / UserID doit être non vide.
type Issue struct {
	IPHash          string
	Fingerprint     string
	UserID          string
	Reason          string
	BannedBy        string        // email admin
	Duration        time.Duration // 0 = permanent
	RelatedReportID *int64
}

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// IssueBan : insère 1 à 3 lignes (une par axe non vide) dans une seule
// transaction + entrée d'audit. Renvoie les IDs créés.
func (s *Service) IssueBan(ctx context.Context, in Issue, ipHashAudit string) ([]int64, error) {
	if in.IPHash == "" && in.Fingerprint == "" && in.UserID == "" {
		return nil, fmt.Errorf("bans: au moins un axe requis (ip/fp/user)")
	}
	if in.BannedBy == "" {
		return nil, fmt.Errorf("bans: BannedBy requis")
	}

	var expiresAt *time.Time
	if in.Duration > 0 {
		t := time.Now().Add(in.Duration)
		expiresAt = &t
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("bans: tx begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	insert := func(tt TargetType, tv string) (int64, error) {
		var id int64
		err := tx.QueryRow(ctx, `
			INSERT INTO bans
			  (target_type, target_value, reason, banned_by, expires_at, related_report_id)
			VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6)
			RETURNING id`,
			tt, tv, in.Reason, in.BannedBy, expiresAt, in.RelatedReportID,
		).Scan(&id)
		return id, err
	}

	var ids []int64
	for _, axis := range []struct {
		t TargetType
		v string
	}{
		{TargetIP, in.IPHash},
		{TargetFingerprint, in.Fingerprint},
		{TargetUser, in.UserID},
	} {
		if axis.v == "" {
			continue
		}
		id, err := insert(axis.t, axis.v)
		if err != nil {
			return nil, fmt.Errorf("bans: insert %s: %w", axis.t, err)
		}
		ids = append(ids, id)
	}

	// Audit log : on log l'action globale (pas une ligne par axe)
	target := summary(in)
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_log (actor, action, target_type, target_value, reason, ip_hash)
		VALUES ($1, 'ban_issued', 'ban', $2, NULLIF($3, ''), $4)`,
		in.BannedBy, target, in.Reason, ipHashAudit); err != nil {
		return nil, fmt.Errorf("bans: insert audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("bans: tx commit: %w", err)
	}
	return ids, nil
}

// CheckActive : renvoie un Ban actif (le plus restrictif) si l'IP hashée ou
// le fingerprint matche un ban non expiré. Retourne (nil, nil) si rien.
func (s *Service) CheckActive(ctx context.Context, ipHash, fingerprint string) (*Ban, error) {
	if ipHash == "" && fingerprint == "" {
		return nil, nil
	}
	// On préfère un ban permanent (expires_at NULL) si plusieurs matchs.
	const q = `
		SELECT id, target_type, target_value, COALESCE(reason, ''),
		       banned_by, expires_at, created_at, related_report_id
		FROM bans
		WHERE ((target_type = 'ip'          AND target_value = $1)
		    OR (target_type = 'fingerprint' AND target_value = $2))
		  AND (expires_at IS NULL OR expires_at > now())
		ORDER BY (expires_at IS NULL) DESC, expires_at DESC NULLS FIRST
		LIMIT 1`
	row := s.pool.QueryRow(ctx, q, ipHash, fingerprint)
	var b Ban
	err := row.Scan(&b.ID, &b.TargetType, &b.TargetValue, &b.Reason,
		&b.BannedBy, &b.ExpiresAt, &b.CreatedAt, &b.RelatedReportID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("bans: check active: %w", err)
	}
	return &b, nil
}

// ListActive renvoie les bans non expirés, triés par date desc.
func (s *Service) ListActive(ctx context.Context, limit int) ([]Ban, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, target_type, target_value, COALESCE(reason, ''),
		       banned_by, expires_at, created_at, related_report_id
		FROM bans
		WHERE expires_at IS NULL OR expires_at > now()
		ORDER BY created_at DESC
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Ban
	for rows.Next() {
		var b Ban
		if err := rows.Scan(&b.ID, &b.TargetType, &b.TargetValue, &b.Reason,
			&b.BannedBy, &b.ExpiresAt, &b.CreatedAt, &b.RelatedReportID); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// Lift : expire un ban immédiatement (set expires_at = now() - 1s) +
// entrée d'audit. Conserve la ligne pour la traçabilité.
func (s *Service) Lift(ctx context.Context, id int64, by, ipHashAudit string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	res, err := tx.Exec(ctx, `
		UPDATE bans SET expires_at = now() - interval '1 second'
		WHERE id = $1 AND (expires_at IS NULL OR expires_at > now())`, id)
	if err != nil {
		return fmt.Errorf("bans: lift update: %w", err)
	}
	if res.RowsAffected() == 0 {
		return fmt.Errorf("bans: lift: ban inactif ou inexistant")
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_log (actor, action, target_type, target_value, ip_hash)
		VALUES ($1, 'ban_lifted', 'ban', $2, $3)`,
		by, fmt.Sprintf("%d", id), ipHashAudit); err != nil {
		return fmt.Errorf("bans: lift audit: %w", err)
	}
	return tx.Commit(ctx)
}

func summary(in Issue) string {
	parts := []string{}
	if in.IPHash != "" {
		parts = append(parts, "ip="+in.IPHash)
	}
	if in.Fingerprint != "" {
		parts = append(parts, "fp="+in.Fingerprint)
	}
	if in.UserID != "" {
		parts = append(parts, "user="+in.UserID)
	}
	s := ""
	for i, p := range parts {
		if i > 0 {
			s += " "
		}
		s += p
	}
	return s
}
