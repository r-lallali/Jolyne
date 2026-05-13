package moderation

import (
	"strings"
	"unicode"
)

// Blocklist regroupe les patterns interdits dans pseudos et messages.
// Implémentation Phase 1 = liste minimale en dur, multilingue (FR/EN/ES/DE),
// substring + fuzzy match basique (leetspeak, espaces insérés).
//
// À remplacer Phase 2 par une lib dédiée + listes maintenues — voir PLAN.md §8.
type Blocklist struct {
	terms []string // déjà normalisés (minuscules, sans accents, sans espaces)
}

func DefaultBlocklist() *Blocklist {
	return &Blocklist{
		terms: []string{
			// Termes sexuels explicites (échantillon — à enrichir)
			"porn", "sexe", "fuck", "puta", "pute", "anal",
			// Slurs raciaux / homophobes (échantillon — à enrichir)
			"nigger", "faggot", "tranny",
			// Mots-clés pédocriminalité (zéro tolérance)
			"cp", "loli", "pedo", "pedophile", "pedofilo",
		},
	}
}

// Contains renvoie true si l'entrée contient (de manière fuzzy) un terme bloqué.
func (b *Blocklist) Contains(s string) bool {
	n := normalize(s)
	for _, t := range b.terms {
		if strings.Contains(n, t) {
			return true
		}
	}
	return false
}

// normalize ramène une chaîne à un canonique : minuscules, sans accents,
// sans espaces, sans ponctuation, leetspeak inversé.
func normalize(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range strings.ToLower(s) {
		r = stripAccent(r)
		r = unleet(r)
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func stripAccent(r rune) rune {
	switch r {
	case 'à', 'á', 'â', 'ä', 'ã', 'å':
		return 'a'
	case 'è', 'é', 'ê', 'ë':
		return 'e'
	case 'ì', 'í', 'î', 'ï':
		return 'i'
	case 'ò', 'ó', 'ô', 'ö', 'õ':
		return 'o'
	case 'ù', 'ú', 'û', 'ü':
		return 'u'
	case 'ñ':
		return 'n'
	case 'ç':
		return 'c'
	}
	return r
}

func unleet(r rune) rune {
	switch r {
	case '0':
		return 'o'
	case '1', '!':
		return 'i'
	case '3':
		return 'e'
	case '4', '@':
		return 'a'
	case '5', '$':
		return 's'
	case '7':
		return 't'
	}
	return r
}
