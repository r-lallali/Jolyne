package users_test

import (
	"strings"
	"testing"
	"time"

	"github.com/ralys/jolyne/backend/internal/users"
)

func TestSignVerify_Roundtrip(t *testing.T) {
	secret := []byte("supersecret-for-tests-only")
	exp := time.Now().Add(24 * time.Hour).Round(time.Second)
	token := users.Sign(users.Session{UserID: 42, ExpiresAt: exp}, secret)

	got, err := users.VerifySession(token, secret)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if got.UserID != 42 {
		t.Fatalf("uid: got %d, want 42", got.UserID)
	}
	if !got.ExpiresAt.Equal(exp) {
		t.Fatalf("exp: got %v, want %v", got.ExpiresAt, exp)
	}
}

func TestVerify_RejectsBadSignature(t *testing.T) {
	good := []byte("good-secret")
	bad := []byte("evil-secret")
	token := users.Sign(users.Session{UserID: 1, ExpiresAt: time.Now().Add(time.Hour)}, good)
	if _, err := users.VerifySession(token, bad); err == nil {
		t.Fatal("verify avec mauvais secret devrait échouer")
	}
}

func TestVerify_RejectsTampered(t *testing.T) {
	secret := []byte("s")
	token := users.Sign(users.Session{UserID: 7, ExpiresAt: time.Now().Add(time.Hour)}, secret)
	// Flip un caractère du payload (avant le point).
	dot := strings.Index(token, ".")
	if dot <= 0 {
		t.Fatalf("token sans point: %q", token)
	}
	tampered := flipFirstAlnum(token[:dot]) + token[dot:]
	if tampered == token {
		t.Skip("rien à flipper")
	}
	if _, err := users.VerifySession(tampered, secret); err == nil {
		t.Fatal("payload modifié doit être rejeté")
	}
}

func TestVerify_RejectsExpired(t *testing.T) {
	secret := []byte("s")
	token := users.Sign(users.Session{UserID: 1, ExpiresAt: time.Now().Add(-time.Minute)}, secret)
	if _, err := users.VerifySession(token, secret); err == nil {
		t.Fatal("token expiré doit être rejeté")
	}
}

func TestVerify_RejectsMalformed(t *testing.T) {
	secret := []byte("s")
	cases := []string{
		"",
		".",
		"abc",
		"nopointhere",
		".onlyrightside",
		"onlyleftside.",
	}
	for _, in := range cases {
		t.Run(in, func(t *testing.T) {
			if _, err := users.VerifySession(in, secret); err == nil {
				t.Fatalf("malformé %q doit être rejeté", in)
			}
		})
	}
}

// flipFirstAlnum remplace le premier caractère alphanumérique pour casser
// la signature sans transformer le token en chaîne invalide base64.
func flipFirstAlnum(s string) string {
	b := []byte(s)
	for i, c := range b {
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') {
			if c == 'A' {
				b[i] = 'B'
			} else {
				b[i] = 'A'
			}
			break
		}
	}
	return string(b)
}
