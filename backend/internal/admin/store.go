package admin

import (
	"context"
	"encoding/json"
	"errors"
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

// ReportDetail inclut le contenu déchiffré pour la vue détail + l'historique
// complet des actions admin (audit_log filtré).
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
	History             []ReportEvent             `json:"history"`
}

// ReportEvent est une entrée d'audit_log pour ce signalement (résolu /
// ignoré / réouvert). Triée par ordre chronologique ascendant.
type ReportEvent struct {
	// report_resolved | report_reopened (et report_dismissed historique
	// pour les audit_log antérieurs à la suppression de cette catégorie).
	Action    string    `json:"action"`
	Actor     string    `json:"actor"`
	Note      string    `json:"note,omitempty"`
	CreatedAt time.Time `json:"created_at"`
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
	// "closed" est un alias pour 'resolved' — historique de quand on avait
	// aussi 'dismissed', gardé pour ne pas casser l'URL côté admin.
	const q = `
		SELECT id, reported_nick, reported_fingerprint,
		       COALESCE(reason, ''), status, created_at
		FROM reports
		WHERE ($1 = ''
		       OR ($1 = 'closed' AND status = 'resolved')
		       OR status = $1)
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3`
	rows, err := s.pool.Query(ctx, q, status, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("admin: list reports: %w", err)
	}
	defer rows.Close()
	out := []ReportSummary{}
	for rows.Next() {
		var r ReportSummary
		if err := rows.Scan(&r.ID, &r.ReportedNick, &r.ReportedFingerprint, &r.Reason, &r.Status, &r.CreatedAt); err != nil {
			return nil, fmt.Errorf("admin: scan report: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ReportHistory : remonte les événements admin (resolved / reopened, plus
// d'éventuels dismissed historiques) consignés dans audit_log pour ce
// signalement, ordre chrono.
func (s *Store) ReportHistory(ctx context.Context, id int64) ([]ReportEvent, error) {
	const q = `
		SELECT action, actor, COALESCE(reason, ''), created_at
		FROM audit_log
		WHERE target_type = 'report' AND target_value = $1
		ORDER BY created_at ASC`
	rows, err := s.pool.Query(ctx, q, fmt.Sprintf("%d", id))
	if err != nil {
		return nil, fmt.Errorf("admin: report history: %w", err)
	}
	defer rows.Close()
	// Slice non-nil pour que JSON sérialise [] et pas null — sinon le
	// front crash sur `.length`.
	out := []ReportEvent{}
	for rows.Next() {
		var e ReportEvent
		if err := rows.Scan(&e.Action, &e.Actor, &e.Note, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("admin: scan history: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// GetReport : détail + déchiffrement des messages capturés + historique.
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
		if errors.Is(err, pgx.ErrNoRows) {
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
	if d.Messages == nil {
		d.Messages = []reports.CapturedMessage{}
	}
	history, err := s.ReportHistory(ctx, id)
	if err != nil {
		return ReportDetail{}, err
	}
	d.History = history
	return d, nil
}

// ErrReportNotOpen / ErrReportNotClosed : signalent une transition d'état
// invalide. Les handlers renvoient 404 (contrat back-office : on ne
// révèle pas l'état exact).
var (
	ErrReportNotOpen   = fmt.Errorf("admin: report n'est pas open")
	ErrReportNotClosed = fmt.Errorf("admin: report n'est pas clos")
)

// ResolveReport : marque un signalement traité (resolved) + audit.
// Refuse silencieusement si le signalement n'est plus dans l'état 'open'
// (évite de logger une action qui n'a rien changé).
func (s *Store) ResolveReport(ctx context.Context, id int64, status, note, by, ipHash string) error {
	if status != "resolved" {
		return fmt.Errorf("admin: status invalide: %s", status)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("admin: tx begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	res, err := tx.Exec(ctx, `
		UPDATE reports SET
			status = $1,
			resolved_at = now(),
			resolved_by = $2,
			resolution_note = NULLIF($3, '')
		WHERE id = $4 AND status = 'open'`,
		status, by, note, id)
	if err != nil {
		return fmt.Errorf("admin: update report: %w", err)
	}
	if res.RowsAffected() == 0 {
		return ErrReportNotOpen
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_log (actor, action, target_type, target_value, reason, ip_hash)
		VALUES ($1, $2, 'report', $3, NULLIF($4, ''), $5)`,
		by, "report_"+status, fmt.Sprintf("%d", id), note, ipHash); err != nil {
		return fmt.Errorf("admin: insert audit: %w", err)
	}
	return tx.Commit(ctx)
}

// BanTargets renvoie le fingerprint + l'IP hashée du reporté pour ce
// signalement. Utilisé par le handler "Bannir depuis ce signalement".
func (s *Store) BanTargets(ctx context.Context, reportID int64) (fingerprint, ipHash string, err error) {
	row := s.pool.QueryRow(ctx, `
		SELECT reported_fingerprint, reported_ip_hash
		FROM reports WHERE id = $1`, reportID)
	if err := row.Scan(&fingerprint, &ipHash); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", fmt.Errorf("admin: report %d introuvable", reportID)
		}
		return "", "", fmt.Errorf("admin: scan ban targets: %w", err)
	}
	return fingerprint, ipHash, nil
}

// ReopenReport : remet un signalement à l'état 'open' et nettoie les
// champs de résolution. L'historique est préservé dans audit_log — on
// AJOUTE une entrée 'report_reopened' (on n'efface jamais).
func (s *Store) ReopenReport(ctx context.Context, id int64, note, by, ipHash string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("admin: tx begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	res, err := tx.Exec(ctx, `
		UPDATE reports SET
			status = 'open',
			resolved_at = NULL,
			resolved_by = NULL,
			resolution_note = NULL
		WHERE id = $1 AND status = 'resolved'`, id)
	if err != nil {
		return fmt.Errorf("admin: update report (reopen): %w", err)
	}
	if res.RowsAffected() == 0 {
		return ErrReportNotClosed
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_log (actor, action, target_type, target_value, reason, ip_hash)
		VALUES ($1, 'report_reopened', 'report', $2, NULLIF($3, ''), $4)`,
		by, fmt.Sprintf("%d", id), note, ipHash); err != nil {
		return fmt.Errorf("admin: insert audit (reopen): %w", err)
	}
	return tx.Commit(ctx)
}
