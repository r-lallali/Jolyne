package matcher

import (
	"errors"
	"testing"
	"time"
)

func TestValidatePair(t *testing.T) {
	cases := []struct {
		name          string
		speaks, wants LangCode
		want          error
	}{
		{"fr→en", FR, EN, nil},
		{"en→fr", EN, FR, nil},
		{"es→en", ES, EN, nil},
		{"en→es", EN, ES, nil},
		{"de→en", DE, EN, nil},
		{"en→de", EN, DE, nil},
		{"fr→es", FR, ES, nil},
		{"es→fr", ES, FR, nil},
		// Toutes les paires de langues distinctes sont désormais ouvertes.
		{"fr→de", FR, DE, nil},
		{"es→de", ES, DE, nil},
		{"zh→ja", ZH, JA, nil},
		{"ar→en", AR, EN, nil},
		{"ko→pt", KO, PT, nil},
		{"it→fr", IT, FR, nil},
		{"même langue", FR, FR, ErrSameLang},
		{"code inconnu", "xx", EN, ErrInvalidLang},
		{"chaîne vide", "", EN, ErrInvalidLang},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ValidatePair(tc.speaks, tc.wants)
			if !errors.Is(got, tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestQueueNames(t *testing.T) {
	if got := queueOwn(FR, EN); got != "queue:speaks=fr,wants=en" {
		t.Fatalf("queueOwn(fr,en) = %q", got)
	}
	if got := queueTarget(FR, EN); got != "queue:speaks=en,wants=fr" {
		t.Fatalf("queueTarget(fr,en) = %q", got)
	}
}

func TestMatchScore(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	base := MatchScore(now, false, false)
	if base != 1_000_000 {
		t.Fatalf("base score = %v, want 1000000", base)
	}
	// Authentifié + Premium abaissent le score (matché plus tôt).
	auth := MatchScore(now, true, false)
	prem := MatchScore(now, true, true)
	if !(prem < auth && auth < base) {
		t.Fatalf("attendu prem < auth < base, got %v %v %v", prem, auth, base)
	}
}
