package crypto_test

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"testing"

	"github.com/ralys/jolyne/backend/internal/crypto"
)

func genKey(t *testing.T) string {
	t.Helper()
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		t.Fatalf("rand: %v", err)
	}
	return base64.StdEncoding.EncodeToString(b)
}

func TestBox_SealOpenRoundtrip(t *testing.T) {
	box, err := crypto.NewBox(genKey(t))
	if err != nil {
		t.Fatalf("NewBox: %v", err)
	}
	in := []byte("salut bob, comment ça va ?")
	ct, err := box.Seal(in)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	if bytes.Equal(ct, in) {
		t.Fatal("ciphertext == plaintext")
	}
	pt, err := box.Open(ct)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if !bytes.Equal(pt, in) {
		t.Fatalf("roundtrip mismatch: got %q want %q", pt, in)
	}
}

func TestBox_TwoSealsDifferent(t *testing.T) {
	box, _ := crypto.NewBox(genKey(t))
	a, _ := box.Seal([]byte("same plaintext"))
	b, _ := box.Seal([]byte("same plaintext"))
	if bytes.Equal(a, b) {
		t.Fatal("deux Seal du même plaintext doivent différer (nonce aléatoire)")
	}
}

func TestBox_OpenTampered(t *testing.T) {
	box, _ := crypto.NewBox(genKey(t))
	ct, _ := box.Seal([]byte("payload"))
	ct[len(ct)-1] ^= 0xff // flip un bit du tag
	if _, err := box.Open(ct); err == nil {
		t.Fatal("Open devrait échouer sur ciphertext modifié")
	}
}

func TestNewBox_InvalidKeys(t *testing.T) {
	cases := []struct {
		name string
		key  string
	}{
		{"vide", ""},
		{"pas base64", "@@@"},
		{"trop court", base64.StdEncoding.EncodeToString(make([]byte, 16))},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := crypto.NewBox(tc.key); err == nil {
				t.Fatal("attendu erreur, got nil")
			}
		})
	}
}
