package users

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// TokenTTL : validité d'un magic link. Court pour limiter la fenêtre
// d'attaque si un email fuite.
const TokenTTL = 15 * time.Minute

var ErrTokenInvalid = errors.New("users: token invalide ou expiré")

// IssueToken génère un token aléatoire 32 octets (43-char base64url),
// stocke son hash SHA-256 en DB et renvoie le token EN CLAIR. Le caller
// l'envoie par email — le token clair ne doit plus jamais transiter
// ailleurs (jamais loggé, jamais persisté).
func (s *Store) IssueToken(ctx context.Context, userID int64) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("users: random: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	hash := hashToken(token)
	expires := time.Now().Add(TokenTTL)
	_, err := s.pool.Exec(ctx,
		`INSERT INTO auth_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
		hash, userID, expires,
	)
	if err != nil {
		return "", fmt.Errorf("users: insert token: %w", err)
	}
	return token, nil
}

// ConsumeToken : vérifie le token (hash), refuse si expiré ou déjà consommé,
// le marque consommé atomiquement, renvoie le user_id associé.
func (s *Store) ConsumeToken(ctx context.Context, token string) (int64, error) {
	hash := hashToken(token)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("users: tx begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var userID int64
	var expiresAt time.Time
	var consumedAt *time.Time
	err = tx.QueryRow(ctx,
		`SELECT user_id, expires_at, consumed_at FROM auth_tokens WHERE token_hash = $1 FOR UPDATE`,
		hash,
	).Scan(&userID, &expiresAt, &consumedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrTokenInvalid
		}
		return 0, fmt.Errorf("users: select token: %w", err)
	}
	if consumedAt != nil {
		return 0, ErrTokenInvalid
	}
	if time.Now().After(expiresAt) {
		return 0, ErrTokenInvalid
	}

	if _, err := tx.Exec(ctx,
		`UPDATE auth_tokens SET consumed_at = now() WHERE token_hash = $1`,
		hash,
	); err != nil {
		return 0, fmt.Errorf("users: consume token: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("users: tx commit: %w", err)
	}
	return userID, nil
}

// PurgeExpired : à appeler périodiquement (cron). Supprime les tokens
// expirés depuis plus de 24h pour ne pas laisser pourrir auth_tokens.
func (s *Store) PurgeExpired(ctx context.Context) (int64, error) {
	res, err := s.pool.Exec(ctx,
		`DELETE FROM auth_tokens WHERE expires_at < now() - INTERVAL '24 hours'`,
	)
	if err != nil {
		return 0, fmt.Errorf("users: purge tokens: %w", err)
	}
	return res.RowsAffected(), nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
