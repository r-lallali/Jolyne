package users_test

import (
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"

	"github.com/ralys/jolyne/backend/internal/users"
)

func TestHashPassword_RejectsTooShort(t *testing.T) {
	if _, err := users.HashPassword("short"); err == nil {
		t.Fatal("password court doit être rejeté")
	}
}

func TestHashPassword_Verifies(t *testing.T) {
	hash, err := users.HashPassword("correct-horse-battery")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if !strings.HasPrefix(hash, "$2") {
		t.Fatalf("hash inattendu: %q", hash)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte("correct-horse-battery")); err != nil {
		t.Fatalf("bcrypt verify: %v", err)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte("wrong-password")); err == nil {
		t.Fatal("bcrypt doit refuser un mauvais password")
	}
}

func TestHashPassword_NonDeterministic(t *testing.T) {
	a, _ := users.HashPassword("same-password-12345")
	b, _ := users.HashPassword("same-password-12345")
	if a == b {
		t.Fatal("deux hashes du même password doivent différer (salt aléatoire)")
	}
}
