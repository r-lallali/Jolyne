package users

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// ErrEmailUnverified : le provider n'atteste pas l'adresse ET un compte
// existe déjà avec cet email — lier ferait courir un risque de prise de
// contrôle de compte (n'importe qui peut déclarer un email non vérifié
// chez le provider). Le caller renvoie une erreur générique.
var ErrEmailUnverified = errors.New("users: email non vérifié par le provider")

// GetUserIDByIdentity : id du compte lié à (provider, subject), ErrNotFound
// si l'identité n'est connue d'aucun compte.
func (s *Store) GetUserIDByIdentity(ctx context.Context, provider, subject string) (int64, error) {
	var id int64
	err := s.pool.QueryRow(ctx,
		`SELECT user_id FROM user_identities WHERE provider = $1 AND subject = $2`,
		provider, subject,
	).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrNotFound
		}
		return 0, fmt.Errorf("users: get identity: %w", err)
	}
	return id, nil
}

// LinkIdentity : attache (provider, subject) au compte. Idempotent — si
// l'identité est déjà liée (à ce compte ou à un autre), on ne touche rien :
// la PK (provider, subject) garantit qu'une identité ne migre jamais
// silencieusement d'un compte à un autre.
func (s *Store) LinkIdentity(ctx context.Context, userID int64, provider, subject string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO user_identities (provider, subject, user_id)
		 VALUES ($1, $2, $3) ON CONFLICT (provider, subject) DO NOTHING`,
		provider, subject, userID,
	)
	if err != nil {
		return fmt.Errorf("users: link identity: %w", err)
	}
	return nil
}

// CreateOAuthUser : compte sans mot de passe (password_hash NULL — le login
// email+password renverra ErrInvalidCreds, le flow forgot/reset permet d'en
// poser un ensuite). emailVerified = attestation du provider.
func (s *Store) CreateOAuthUser(ctx context.Context, email string, emailVerified bool) (int64, error) {
	email = normalizeEmail(email)
	if email == "" {
		return 0, fmt.Errorf("users: email vide")
	}
	const q = `
		INSERT INTO users (email, email_verified_at)
		VALUES ($1, CASE WHEN $2 THEN now() END)
		RETURNING id`
	var id int64
	if err := s.pool.QueryRow(ctx, q, email, emailVerified).Scan(&id); err != nil {
		if isUniqueViolation(err) {
			return 0, ErrAlreadyExists
		}
		return 0, fmt.Errorf("users: create oauth user: %w", err)
	}
	return id, nil
}

// FindOrCreateByIdentity résout un login OAuth en compte local :
//
//  1. identité déjà liée → login sur ce compte ;
//  2. sinon, compte existant avec le même email → on lie l'identité SI le
//     provider atteste l'adresse (sinon ErrEmailUnverified — cf. supra) et
//     on marque l'email vérifié (le provider vient d'en prouver la propriété) ;
//  3. sinon, création d'un compte sans mot de passe.
//
// Renvoie (userID, created). La course entre deux callbacks concurrents est
// absorbée : unique violation sur users.email → relecture puis lien.
func (s *Store) FindOrCreateByIdentity(ctx context.Context, provider, subject, email string, emailVerified bool) (userID int64, created bool, err error) {
	if id, err := s.GetUserIDByIdentity(ctx, provider, subject); err == nil {
		return id, false, nil
	} else if !errors.Is(err, ErrNotFound) {
		return 0, false, err
	}

	link := func(id int64) (int64, bool, error) {
		if !emailVerified {
			return 0, false, ErrEmailUnverified
		}
		if err := s.LinkIdentity(ctx, id, provider, subject); err != nil {
			return 0, false, err
		}
		if err := s.MarkVerified(ctx, id); err != nil {
			return 0, false, err
		}
		return id, false, nil
	}

	existing, err := s.GetByEmail(ctx, email)
	switch {
	case err == nil:
		return link(existing.ID)
	case !errors.Is(err, ErrNotFound):
		return 0, false, err
	}

	id, err := s.CreateOAuthUser(ctx, email, emailVerified)
	if errors.Is(err, ErrAlreadyExists) {
		// Course perdue contre un signup concurrent : le compte vient
		// d'apparaître, on retombe sur le chemin "lier".
		existing, err := s.GetByEmail(ctx, email)
		if err != nil {
			return 0, false, err
		}
		return link(existing.ID)
	}
	if err != nil {
		return 0, false, err
	}
	if err := s.LinkIdentity(ctx, id, provider, subject); err != nil {
		return 0, false, err
	}
	return id, true, nil
}
