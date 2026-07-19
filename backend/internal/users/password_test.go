package users_test

import (
	"testing"

	"github.com/ralys/jolyne/backend/internal/users"
)

// Miroir exact de la checklist front (lib/password.ts) — voir règle d'or #3.
func TestValidatePassword(t *testing.T) {
	valid := []string{
		"Abcdef12",
		"Motdepasse1",
		"Émile-Zola1", // majuscule accentuée reconnue (unicode.IsUpper)
		"Ééééééé1",    // 8 runes (9+ octets) : la longueur se compte en runes
	}
	for _, pw := range valid {
		if err := users.ValidatePassword(pw); err != nil {
			t.Errorf("ValidatePassword(%q) = %v, attendu nil", pw, err)
		}
	}

	invalid := map[string]string{
		"Abc12":    "trop court",
		"abcdef12": "pas de majuscule",
		"ABCDEF12": "pas de minuscule",
		"Abcdefgh": "pas de chiffre",
		"":         "vide",
		"Éé1":      "trop court même en runes",
	}
	for pw, why := range invalid {
		if err := users.ValidatePassword(pw); err == nil {
			t.Errorf("ValidatePassword(%q) = nil, attendu ErrWeakPassword (%s)", pw, why)
		}
	}
}
