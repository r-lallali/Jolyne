package quota_test

import (
	"testing"

	"github.com/ralys/jolyne/backend/internal/quota"
)

func TestIdentity(t *testing.T) {
	// Connecté → "u:" + userID (stable cross-device, anti-évasion).
	if got := quota.Identity(42, "fp-abc"); got != "u:42" {
		t.Fatalf("user identity: attendu u:42, got %q", got)
	}
	// Anonyme → "fp:" + fingerprint.
	if got := quota.Identity(0, "fp-abc"); got != "fp:fp-abc" {
		t.Fatalf("anon identity: attendu fp:fp-abc, got %q", got)
	}
	// Anonyme sans fingerprint → "" (caller fail-open, pas de bucket partagé).
	if got := quota.Identity(0, ""); got != "" {
		t.Fatalf("identité vide attendue, got %q", got)
	}
	// Espaces de noms disjoints : un compte et un fingerprint imitant un
	// userID ne collisionnent jamais.
	if quota.Identity(7, "x") == quota.Identity(0, "u:7") {
		t.Fatal("collision entre identité compte et fingerprint")
	}
}
