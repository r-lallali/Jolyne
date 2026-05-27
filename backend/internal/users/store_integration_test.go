//go:build integration

package users_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ralys/jolyne/backend/internal/db"
	"github.com/ralys/jolyne/backend/internal/users"
)

func dsn(t *testing.T) string {
	t.Helper()
	v := os.Getenv("TEST_POSTGRES_DSN")
	if v == "" {
		v = "postgres://jolyne:jolyne@127.0.0.1:5432/jolyne?sslmode=disable"
	}
	return v
}

func newPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	d := dsn(t)
	pool, err := db.New(context.Background(), d)
	if err != nil {
		t.Skipf("postgres indisponible: %v", err)
	}
	if err := db.RunMigrations(d); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM auth_tokens WHERE user_id IN (
			    SELECT id FROM users WHERE email LIKE '%@userstest.local')`)
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM users WHERE email LIKE '%@userstest.local'`)
		pool.Close()
	})
	return pool
}

func uniqEmail() string {
	return fmt.Sprintf("u-%d@userstest.local", time.Now().UnixNano())
}

func TestCreate_RejectsDuplicateEmail(t *testing.T) {
	pool := newPool(t)
	s := users.NewStore(pool)
	email := uniqEmail()
	hash, _ := users.HashPassword("password-12345")
	if _, err := s.Create(context.Background(), email, hash); err != nil {
		t.Fatalf("create 1: %v", err)
	}
	_, err := s.Create(context.Background(), email, hash)
	if !errors.Is(err, users.ErrAlreadyExists) {
		t.Fatalf("err: %v (want ErrAlreadyExists)", err)
	}
}

func TestCreate_NormalizesEmail(t *testing.T) {
	pool := newPool(t)
	s := users.NewStore(pool)
	email := uniqEmail()
	hash, _ := users.HashPassword("password-12345")
	u, err := s.Create(context.Background(), "  "+email+"  ", hash)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if u.Email != email {
		t.Fatalf("email = %q, want %q (trim+lower)", u.Email, email)
	}
	// Cas mixte → doit retrouver le même user.
	mixed := uniqEmail()
	if _, err := s.Create(context.Background(), mixed, hash); err != nil {
		t.Fatalf("create mixed: %v", err)
	}
	_, err = s.Create(context.Background(),
		"  "+upperPrefix(mixed)+"  ", hash)
	if !errors.Is(err, users.ErrAlreadyExists) {
		t.Fatalf("email casse différente doit clasher: %v", err)
	}
}

func TestLogin_OK(t *testing.T) {
	pool := newPool(t)
	s := users.NewStore(pool)
	email := uniqEmail()
	hash, _ := users.HashPassword("good-password-1")
	if _, err := s.Create(context.Background(), email, hash); err != nil {
		t.Fatalf("create: %v", err)
	}
	u, err := s.Login(context.Background(), email, "good-password-1")
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if u.Email != email {
		t.Fatalf("email: %q", u.Email)
	}
	if !u.HasPassword {
		t.Fatal("HasPassword doit être true")
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	pool := newPool(t)
	s := users.NewStore(pool)
	email := uniqEmail()
	hash, _ := users.HashPassword("good-password-1")
	_, _ = s.Create(context.Background(), email, hash)

	_, err := s.Login(context.Background(), email, "bad-password")
	if !errors.Is(err, users.ErrInvalidCreds) {
		t.Fatalf("err: %v (want ErrInvalidCreds)", err)
	}
}

func TestLogin_UnknownEmail(t *testing.T) {
	pool := newPool(t)
	s := users.NewStore(pool)
	_, err := s.Login(context.Background(), uniqEmail(), "whatever")
	if !errors.Is(err, users.ErrInvalidCreds) {
		t.Fatalf("err: %v", err)
	}
}

func TestGetByID_NotFound(t *testing.T) {
	pool := newPool(t)
	s := users.NewStore(pool)
	_, err := s.GetByID(context.Background(), 9_999_999_999)
	if !errors.Is(err, users.ErrNotFound) {
		t.Fatalf("err: %v", err)
	}
}

func TestMarkVerified_SetsTimestamp(t *testing.T) {
	pool := newPool(t)
	s := users.NewStore(pool)
	email := uniqEmail()
	hash, _ := users.HashPassword("password-12345")
	u, _ := s.Create(context.Background(), email, hash)
	if u.EmailVerifiedAt != nil {
		t.Fatal("nouveau compte ne doit pas être vérifié")
	}
	if err := s.MarkVerified(context.Background(), u.ID); err != nil {
		t.Fatalf("mark: %v", err)
	}
	got, _ := s.GetByID(context.Background(), u.ID)
	if got.EmailVerifiedAt == nil {
		t.Fatal("EmailVerifiedAt devrait être posé")
	}
}

func TestIssueAndConsumeToken_Roundtrip(t *testing.T) {
	pool := newPool(t)
	s := users.NewStore(pool)
	email := uniqEmail()
	hash, _ := users.HashPassword("password-12345")
	u, _ := s.Create(context.Background(), email, hash)

	token, err := s.IssueToken(context.Background(), u.ID, users.PurposeVerifyEmail)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if token == "" {
		t.Fatal("token vide")
	}

	gotID, err := s.ConsumeToken(context.Background(), token, users.PurposeVerifyEmail)
	if err != nil {
		t.Fatalf("consume: %v", err)
	}
	if gotID != u.ID {
		t.Fatalf("uid: %d, want %d", gotID, u.ID)
	}

	// Re-consumer un token déjà utilisé doit échouer.
	if _, err := s.ConsumeToken(context.Background(), token, users.PurposeVerifyEmail); !errors.Is(err, users.ErrTokenInvalid) {
		t.Fatalf("réutilisation: %v (want ErrTokenInvalid)", err)
	}
}

func TestConsumeToken_WrongPurpose(t *testing.T) {
	pool := newPool(t)
	s := users.NewStore(pool)
	email := uniqEmail()
	hash, _ := users.HashPassword("password-12345")
	u, _ := s.Create(context.Background(), email, hash)
	token, _ := s.IssueToken(context.Background(), u.ID, users.PurposeVerifyEmail)
	// Tente de l'utiliser pour password_reset.
	_, err := s.ConsumeToken(context.Background(), token, users.PurposePasswordReset)
	if !errors.Is(err, users.ErrTokenInvalid) {
		t.Fatalf("err: %v (want ErrTokenInvalid)", err)
	}
}

func TestConsumeToken_InvalidString(t *testing.T) {
	pool := newPool(t)
	s := users.NewStore(pool)
	_, err := s.ConsumeToken(context.Background(), "garbage-token", users.PurposeVerifyEmail)
	if !errors.Is(err, users.ErrTokenInvalid) {
		t.Fatalf("err: %v", err)
	}
}

func upperPrefix(s string) string {
	// Upper-case le 1er caractère pour tester la casse-insensibilité.
	if s == "" {
		return s
	}
	c := s[0]
	if c >= 'a' && c <= 'z' {
		c -= 32
	}
	return string(c) + s[1:]
}
