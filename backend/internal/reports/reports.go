// Package reports persiste les signalements en Postgres avec les messages
// capturés chiffrés (AES-256-GCM). Voir CLAUDE.md §RGPD & DSA et la
// migration `internal/db/migrations/0001_init.up.sql`.
package reports

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ralys/jolyne/backend/internal/crypto"
)

// CapturedMessage est une entrée du contexte capturé au moment du
// signalement. Ne quitte le serveur sous forme chiffrée que.
type CapturedMessage struct {
	From string `json:"from"` // pseudo de l'émetteur (le reporter ou le reporté)
	Body string `json:"body"`
	At   string `json:"at"` // RFC3339Nano UTC
}

// Report est ce qui est enregistré dans la table `reports`. Tous les
// champs sont obligatoires sauf `Reason`.
type Report struct {
	ReporterSession     string
	ReporterFingerprint string
	ReporterIPHash      string
	ReportedSession     string
	ReportedFingerprint string
	ReportedNick        string
	Reason              string
	Messages            []CapturedMessage
}

// Service expose l'enregistrement d'un signalement. Pas de méthode de
// lecture pour l'instant — la file d'attente sera consommée par le
// back-office admin (Phase 2, à venir).
type Service struct {
	pool *pgxpool.Pool
	box  *crypto.Box
}

func NewService(pool *pgxpool.Pool, box *crypto.Box) *Service {
	return &Service{pool: pool, box: box}
}

// Save chiffre les messages capturés et insère le signalement. Renvoie
// l'ID de la ligne créée.
func (s *Service) Save(ctx context.Context, r Report) (int64, error) {
	payload, err := json.Marshal(struct {
		Messages []CapturedMessage `json:"messages"`
		At       string            `json:"at"`
	}{Messages: r.Messages, At: time.Now().UTC().Format(time.RFC3339Nano)})
	if err != nil {
		return 0, fmt.Errorf("reports: marshal: %w", err)
	}
	ciphered, err := s.box.Seal(payload)
	if err != nil {
		return 0, fmt.Errorf("reports: encrypt: %w", err)
	}
	const q = `
		INSERT INTO reports (
			reporter_session, reporter_fingerprint, reporter_ip_hash,
			reported_session, reported_fingerprint, reported_nick,
			reason, captured_messages
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id`
	var id int64
	if err := s.pool.QueryRow(ctx, q,
		r.ReporterSession, r.ReporterFingerprint, r.ReporterIPHash,
		r.ReportedSession, r.ReportedFingerprint, r.ReportedNick,
		nullIfEmpty(r.Reason), ciphered,
	).Scan(&id); err != nil {
		return 0, fmt.Errorf("reports: insert: %w", err)
	}
	return id, nil
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
