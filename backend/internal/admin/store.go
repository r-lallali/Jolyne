package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ralys/jolyne/backend/internal/crypto"
	"github.com/ralys/jolyne/backend/internal/reports"
)

// ReportSummary est un résumé pour l'affichage en liste — ne contient PAS
// les messages déchiffrés (privacy by default — décryption à la demande).
type ReportSummary struct {
	ID                  int64     `json:"id"`
	ReportedNick        string    `json:"reported_nick"`
	ReportedFingerprint string    `json:"reported_fingerprint"`
	Reason              string    `json:"reason,omitempty"`
	Status              string    `json:"status"`
	CreatedAt           time.Time `json:"created_at"`
}

// ReportDetail inclut le contenu déchiffré pour la vue détail.
type ReportDetail struct {
	ReportSummary
	ReporterSession     string                    `json:"reporter_session"`
	ReporterFingerprint string                    `json:"reporter_fingerprint"`
	ReporterIPHash      string                    `json:"reporter_ip_hash"`
	ReportedSession     string                    `json:"reported_session"`
	Messages            []reports.CapturedMessage `json:"messages"`
	ResolvedAt          *time.Time                `json:"resolved_at,omitempty"`
	ResolvedBy          string                    `json:"resolved_by,omitempty"`
	ResolutionNote      string                    `json:"resolution_note,omitempty"`
}

// Store : accès Postgres pour le back-office. Le service en lui-même
// n'applique pas l'auth (faite en amont par le middleware).
type Store struct {
	pool *pgxpool.Pool
	box  *crypto.Box
}

func NewStore(pool *pgxpool.Pool, box *crypto.Box) *Store {
	return &Store{pool: pool, box: box}
}

// ListReports renvoie une page de signalements filtrés par statut.
func (s *Store) ListReports(ctx context.Context, status string, limit, offset int) ([]ReportSummary, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	const q = `
		SELECT id, reported_nick, reported_fingerprint,
		       COALESCE(reason, ''), status, created_at
		FROM reports
		WHERE ($1 = '' OR status = $1)
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3`
	rows, err := s.pool.Query(ctx, q, status, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("admin: list reports: %w", err)
	}
	defer rows.Close()
	var out []ReportSummary
	for rows.Next() {
		var r ReportSummary
		if err := rows.Scan(&r.ID, &r.ReportedNick, &r.ReportedFingerprint, &r.Reason, &r.Status, &r.CreatedAt); err != nil {
			return nil, fmt.Errorf("admin: scan report: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetReport : détail + déchiffrement des messages capturés.
func (s *Store) GetReport(ctx context.Context, id int64) (ReportDetail, error) {
	const q = `
		SELECT id, reporter_session, reporter_fingerprint, reporter_ip_hash,
		       reported_session, reported_fingerprint, reported_nick,
		       COALESCE(reason, ''), status, created_at,
		       resolved_at, COALESCE(resolved_by, ''), COALESCE(resolution_note, ''),
		       captured_messages
		FROM reports WHERE id = $1`
	var d ReportDetail
	var ciphered []byte
	err := s.pool.QueryRow(ctx, q, id).Scan(
		&d.ID, &d.ReporterSession, &d.ReporterFingerprint, &d.ReporterIPHash,
		&d.ReportedSession, &d.ReportedFingerprint, &d.ReportedNick,
		&d.Reason, &d.Status, &d.CreatedAt,
		&d.ResolvedAt, &d.ResolvedBy, &d.ResolutionNote,
		&ciphered,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return ReportDetail{}, fmt.Errorf("admin: report %d not found", id)
		}
		return ReportDetail{}, fmt.Errorf("admin: get report: %w", err)
	}
	plain, err := s.box.Open(ciphered)
	if err != nil {
		return ReportDetail{}, fmt.Errorf("admin: decrypt report: %w", err)
	}
	var wrapper struct {
		Messages []reports.CapturedMessage `json:"messages"`
	}
	if err := json.Unmarshal(plain, &wrapper); err != nil {
		return ReportDetail{}, fmt.Errorf("admin: unmarshal messages: %w", err)
	}
	d.Messages = wrapper.Messages
	return d, nil
}

// ResolveReport : marque un signalement traité (resolved/dismissed) + audit.
// Idempotent : si déjà dans ce statut, no-op silencieux.
func (s *Store) ResolveReport(ctx context.Context, id int64, status, note, by, ipHash string) error {
	if status != "resolved" && status != "dismissed" {
		return fmt.Errorf("admin: status invalide: %s", status)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("admin: tx begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
		UPDATE reports SET
			status = $1,
			resolved_at = now(),
			resolved_by = $2,
			resolution_note = NULLIF($3, '')
		WHERE id = $4 AND status = 'open'`,
		status, by, note, id); err != nil {
		return fmt.Errorf("admin: update report: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_log (actor, action, target_type, target_value, reason, ip_hash)
		VALUES ($1, $2, 'report', $3, NULLIF($4, ''), $5)`,
		by, "report_"+status, fmt.Sprintf("%d", id), note, ipHash); err != nil {
		return fmt.Errorf("admin: insert audit: %w", err)
	}
	return tx.Commit(ctx)
}
