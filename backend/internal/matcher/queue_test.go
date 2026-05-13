package matcher

import (
	"errors"
	"testing"
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
		{"fr→de non ouverte", FR, DE, ErrPairNotOpen},
		{"es→de non ouverte", ES, DE, ErrPairNotOpen},
		{"même langue", FR, FR, ErrSameLang},
		{"code inconnu", "it", EN, ErrInvalidLang},
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
