// Package users : modèle utilisateur + opérations DB (compte créé via
// email + mot de passe, email vérifié une seule fois). Voir PLAN.md §4
// Phase 3.
package users

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrNotFound      = errors.New("users: not found")
	ErrAlreadyExists = errors.New("users: email déjà utilisé")
	ErrInvalidCreds  = errors.New("users: identifiants invalides")
	ErrNoPassword    = errors.New("users: pas de password (compte legacy)")
)

// Min bcrypt cost (10 = ~80ms). Au-delà, login devient lent sur petits VPS.
const bcryptCost = 10

// PasswordMinLen : 8 caractères minimum. Pas plus exigeant — la longueur
// fait l'essentiel de la sécurité (cf. NIST 800-63b).
const PasswordMinLen = 8

type User struct {
	ID              int64
	Email           string
	CreatedAt       time.Time
	LastSeenAt      *time.Time
	EmailVerifiedAt *time.Time
	HasPassword     bool
}

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// HashPassword : bcrypt avec coût raisonnable. Renvoie une erreur si le
// password est trop court — caller doit vérifier avant.
func HashPassword(password string) (string, error) {
	if len(password) < PasswordMinLen {
		return "", fmt.Errorf("password trop court (min %d)", PasswordMinLen)
	}
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return "", fmt.Errorf("users: hash: %w", err)
	}
	return string(h), nil
}

// Create : INSERT user avec password. ErrAlreadyExists si email taken.
func (s *Store) Create(ctx context.Context, email, passwordHash string) (User, error) {
	email = normalizeEmail(email)
	if email == "" {
		return User{}, fmt.Errorf("users: email vide")
	}
	const q = `
		INSERT INTO users (email, password_hash)
		VALUES ($1, $2)
		RETURNING id, email, created_at, last_seen_at, email_verified_at`
	var u User
	err := s.pool.QueryRow(ctx, q, email, passwordHash).Scan(
		&u.ID, &u.Email, &u.CreatedAt, &u.LastSeenAt, &u.EmailVerifiedAt,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return User{}, ErrAlreadyExists
		}
		return User{}, fmt.Errorf("users: create: %w", err)
	}
	u.HasPassword = true
	return u, nil
}

// Login : vérifie email + password. Renvoie ErrInvalidCreds pour TOUT
// échec (email inconnu, password faux, compte sans password) pour ne
// pas leak quelle erreur précise.
func (s *Store) Login(ctx context.Context, email, password string) (User, error) {
	email = normalizeEmail(email)
	const q = `
		SELECT id, email, created_at, last_seen_at, email_verified_at,
		       COALESCE(password_hash, '')
		FROM users WHERE email = $1`
	var u User
	var hash string
	err := s.pool.QueryRow(ctx, q, email).Scan(
		&u.ID, &u.Email, &u.CreatedAt, &u.LastSeenAt, &u.EmailVerifiedAt, &hash,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return User{}, ErrInvalidCreds
		}
		return User{}, fmt.Errorf("users: login lookup: %w", err)
	}
	if hash == "" {
		return User{}, ErrInvalidCreds
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return User{}, ErrInvalidCreds
	}
	u.HasPassword = true
	return u, nil
}

func (s *Store) GetByID(ctx context.Context, id int64) (User, error) {
	const q = `
		SELECT id, email, created_at, last_seen_at, email_verified_at,
		       password_hash IS NOT NULL
		FROM users WHERE id = $1`
	var u User
	if err := s.pool.QueryRow(ctx, q, id).Scan(
		&u.ID, &u.Email, &u.CreatedAt, &u.LastSeenAt, &u.EmailVerifiedAt, &u.HasPassword,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return User{}, ErrNotFound
		}
		return User{}, fmt.Errorf("users: get by id: %w", err)
	}
	return u, nil
}

// GetByEmail : utilisé par le flow forgot (récupère user pour issuer un
// token reset). Renvoie ErrNotFound silencieusement — le handler choisit
// quoi en faire (en général : 204 dans tous les cas pour ne pas leak).
func (s *Store) GetByEmail(ctx context.Context, email string) (User, error) {
	email = normalizeEmail(email)
	const q = `
		SELECT id, email, created_at, last_seen_at, email_verified_at,
		       password_hash IS NOT NULL
		FROM users WHERE email = $1`
	var u User
	if err := s.pool.QueryRow(ctx, q, email).Scan(
		&u.ID, &u.Email, &u.CreatedAt, &u.LastSeenAt, &u.EmailVerifiedAt, &u.HasPassword,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return User{}, ErrNotFound
		}
		return User{}, fmt.Errorf("users: get by email: %w", err)
	}
	return u, nil
}

func (s *Store) MarkVerified(ctx context.Context, id int64) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE users SET email_verified_at = now() WHERE id = $1 AND email_verified_at IS NULL`,
		id,
	)
	if err != nil {
		return fmt.Errorf("users: mark verified: %w", err)
	}
	return nil
}

func (s *Store) SetPassword(ctx context.Context, id int64, passwordHash string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE users SET password_hash = $1 WHERE id = $2`,
		passwordHash, id,
	)
	if err != nil {
		return fmt.Errorf("users: set password: %w", err)
	}
	return nil
}

func (s *Store) TouchLastSeen(ctx context.Context, id int64) error {
	_, err := s.pool.Exec(ctx, `UPDATE users SET last_seen_at = now() WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("users: touch last seen: %w", err)
	}
	return nil
}

func normalizeEmail(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

// isUniqueViolation : code SQLSTATE 23505 (Postgres unique_violation).
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "SQLSTATE 23505") || strings.Contains(msg, "23505")
}
