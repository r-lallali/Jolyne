package moderation

import (
	"errors"
	"testing"
)

func TestValidatePseudo(t *testing.T) {
	b := DefaultBlocklist()
	cases := []struct {
		name string
		in   string
		want error
	}{
		{"ok basique", "alice", nil},
		{"ok accent", "élise", nil},
		{"ok avec chiffres", "user42", nil},
		{"ok hyphen", "jean-luc", nil},
		{"ok underscore", "alice_b", nil},
		{"trop court", "ab", ErrPseudoLength},
		{"trop long", "abcdefghijklmnopqrstu", ErrPseudoLength},
		{"vide", "", ErrPseudoLength},
		{"que des chiffres", "12345", ErrPseudoDigitOnly},
		{"espace interdit", "ali ce", ErrPseudoCharset},
		{"point interdit", "alice.b", ErrPseudoCharset},
		{"emoji interdit", "alice🎉", ErrPseudoCharset},
		{"obscénité directe", "FuckUser", ErrPseudoBlocked},
		{"obscénité leet", "fvck", nil}, // hors blocklist actuelle (cas limite documenté)
		{"obscénité chiffres", "puta1", ErrPseudoBlocked},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ValidatePseudo(tc.in, b)
			if !errors.Is(got, tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}
