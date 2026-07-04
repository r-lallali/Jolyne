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
	"github.com/jackc/pgx/v5/pgconn"
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

// dummyHash : hash bcrypt d'une valeur bidon, comparé quand l'email est inconnu
// (ou sans password) pour égaliser le temps de réponse du login — sinon la
// présence/absence d'un bcrypt trahit l'existence du compte (énumération par
// timing). Calculé une fois au chargement du package.
var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("timing-equalizer"), bcryptCost)

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
	// SessionVersion : compteur de révocation. Un cookie signé avec une version
	// < à celle-ci est rejeté (reset de mot de passe → +1).
	SessionVersion int64

	// Abonnement Premium (miroir de Stripe, posé par le webhook). Plan est
	// le cache dérivé lisible ('free'|'premium') ; IsPremium recalcule le
	// droit réel à partir du statut + de la fin de période.
	Plan               string
	SubscriptionStatus *string
	CurrentPeriodEnd   *time.Time
	StripeCustomerID   *string
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
		RETURNING id, email, created_at, last_seen_at, email_verified_at,
		          plan, subscription_status, current_period_end, stripe_customer_id`
	var u User
	err := s.pool.QueryRow(ctx, q, email, passwordHash).Scan(
		&u.ID, &u.Email, &u.CreatedAt, &u.LastSeenAt, &u.EmailVerifiedAt,
		&u.Plan, &u.SubscriptionStatus, &u.CurrentPeriodEnd, &u.StripeCustomerID,
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
		       COALESCE(password_hash, ''),
		       plan, subscription_status, current_period_end, stripe_customer_id,
		       session_version
		FROM users WHERE email = $1`
	var u User
	var hash string
	err := s.pool.QueryRow(ctx, q, email).Scan(
		&u.ID, &u.Email, &u.CreatedAt, &u.LastSeenAt, &u.EmailVerifiedAt, &hash,
		&u.Plan, &u.SubscriptionStatus, &u.CurrentPeriodEnd, &u.StripeCustomerID,
		&u.SessionVersion,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Compare bidon : même coût CPU qu'un compte existant → pas de fuite
			// d'existence par timing.
			_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(password))
			return User{}, ErrInvalidCreds
		}
		return User{}, fmt.Errorf("users: login lookup: %w", err)
	}
	if hash == "" {
		_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(password))
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
		       password_hash IS NOT NULL,
		       plan, subscription_status, current_period_end, stripe_customer_id,
		       session_version
		FROM users WHERE id = $1`
	var u User
	if err := s.pool.QueryRow(ctx, q, id).Scan(
		&u.ID, &u.Email, &u.CreatedAt, &u.LastSeenAt, &u.EmailVerifiedAt, &u.HasPassword,
		&u.Plan, &u.SubscriptionStatus, &u.CurrentPeriodEnd, &u.StripeCustomerID,
		&u.SessionVersion,
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
		       password_hash IS NOT NULL,
		       plan, subscription_status, current_period_end, stripe_customer_id
		FROM users WHERE email = $1`
	var u User
	if err := s.pool.QueryRow(ctx, q, email).Scan(
		&u.ID, &u.Email, &u.CreatedAt, &u.LastSeenAt, &u.EmailVerifiedAt, &u.HasPassword,
		&u.Plan, &u.SubscriptionStatus, &u.CurrentPeriodEnd, &u.StripeCustomerID,
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

// SetPassword change le hash ET incrémente session_version dans la même
// requête : un reset révoque atomiquement toutes les sessions déjà ouvertes
// (le nouveau cookie posé juste après embarque la version à jour). Renvoie la
// nouvelle version pour que le caller ré-ouvre une session cohérente.
func (s *Store) SetPassword(ctx context.Context, id int64, passwordHash string) (int64, error) {
	var version int64
	err := s.pool.QueryRow(ctx,
		`UPDATE users SET password_hash = $1, session_version = session_version + 1
		   WHERE id = $2 RETURNING session_version`,
		passwordHash, id,
	).Scan(&version)
	if err != nil {
		return 0, fmt.Errorf("users: set password: %w", err)
	}
	return version, nil
}

// SessionVersion lit le compteur de révocation courant d'un user. Sert au
// check de version côté WS (le middleware HTTP le tient déjà via GetByID).
func (s *Store) SessionVersion(ctx context.Context, id int64) (int64, error) {
	var v int64
	if err := s.pool.QueryRow(ctx, `SELECT session_version FROM users WHERE id = $1`, id).Scan(&v); err != nil {
		return 0, fmt.Errorf("users: session version: %w", err)
	}
	return v, nil
}

func (s *Store) TouchLastSeen(ctx context.Context, id int64) error {
	_, err := s.pool.Exec(ctx, `UPDATE users SET last_seen_at = now() WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("users: touch last seen: %w", err)
	}
	return nil
}

// IsPremium : droit Premium effectif = abonnement actif/essai ET période non
// expirée. Recalculé depuis les colonnes miroir (jamais d'appel Stripe ici).
// Un user inconnu ou sans abonnement est Free (false, sans erreur).
func (s *Store) IsPremium(ctx context.Context, userID int64) (bool, error) {
	const q = `
		SELECT COALESCE(subscription_status IN ('active','trialing'), false)
		   AND (current_period_end IS NULL OR current_period_end > now())
		FROM users WHERE id = $1`
	var premium bool
	if err := s.pool.QueryRow(ctx, q, userID).Scan(&premium); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("users: is premium: %w", err)
	}
	return premium, nil
}

// UserIDByCustomerID : résout l'id user depuis son customer Stripe (0 si
// inconnu). Sert au tracking analytics des events premium reçus par webhook.
func (s *Store) UserIDByCustomerID(ctx context.Context, customerID string) int64 {
	var id int64
	err := s.pool.QueryRow(ctx,
		`SELECT id FROM users WHERE stripe_customer_id = $1`, customerID).Scan(&id)
	if err != nil {
		return 0
	}
	return id
}

// SetCustomerID : lie un customer Stripe au user (posé au 1er checkout).
func (s *Store) SetCustomerID(ctx context.Context, userID int64, customerID string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE users SET stripe_customer_id = $1 WHERE id = $2`,
		customerID, userID,
	)
	if err != nil {
		return fmt.Errorf("users: set customer id: %w", err)
	}
	return nil
}

// SetSubscription : miroite l'état d'abonnement Stripe sur la ligne user,
// identifiée par son customer Stripe. Dérive `plan` du statut. Appelé par le
// webhook — l'effet est idempotent (même état entrant = même ligne finale).
func (s *Store) SetSubscription(ctx context.Context, customerID, status string, periodEnd *time.Time) error {
	plan := "free"
	if status == "active" || status == "trialing" {
		plan = "premium"
	}
	_, err := s.pool.Exec(ctx,
		`UPDATE users
		    SET subscription_status = $1, current_period_end = $2, plan = $3
		  WHERE stripe_customer_id = $4`,
		status, periodEnd, plan, customerID,
	)
	if err != nil {
		return fmt.Errorf("users: set subscription: %w", err)
	}
	return nil
}

func normalizeEmail(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

// isUniqueViolation : code SQLSTATE 23505 (Postgres unique_violation). On
// inspecte l'erreur typée pgconn plutôt que son texte (robuste aux variations
// de message / localisation).
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
