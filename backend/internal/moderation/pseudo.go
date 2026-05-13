package moderation

import (
	"errors"
	"unicode"
	"unicode/utf8"
)

const (
	pseudoMinLen = 3
	pseudoMaxLen = 20
)

var (
	ErrPseudoLength    = errors.New("pseudo: longueur invalide (3-20)")
	ErrPseudoCharset   = errors.New("pseudo: caractère interdit")
	ErrPseudoDigitOnly = errors.New("pseudo: au moins une lettre requise")
	ErrPseudoBlocked   = errors.New("pseudo: refusé par le filtre")
)

// ValidatePseudo applique les règles du pseudo public (visible par le peer
// pendant le chat). Côté serveur uniquement — le client ne peut pas être
// confident (CLAUDE.md règle d'or #3).
func ValidatePseudo(raw string, block *Blocklist) error {
	count := utf8.RuneCountInString(raw)
	if count < pseudoMinLen || count > pseudoMaxLen {
		return ErrPseudoLength
	}
	hasLetter := false
	for _, r := range raw {
		switch {
		case unicode.IsLetter(r):
			hasLetter = true
		case unicode.IsDigit(r):
		case r == '-' || r == '_':
		default:
			return ErrPseudoCharset
		}
	}
	if !hasLetter {
		return ErrPseudoDigitOnly
	}
	if block.Contains(raw) {
		return ErrPseudoBlocked
	}
	return nil
}
