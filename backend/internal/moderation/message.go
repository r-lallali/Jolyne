package moderation

import (
	"errors"
	"strings"
	"unicode/utf8"
)

const messageMaxLen = 2000

var (
	ErrMessageEmpty   = errors.New("message vide")
	ErrMessageTooLong = errors.New("message trop long")
	ErrMessageBlocked = errors.New("message refusé par le filtre")
)

// SanitizeAndCheck applique les contraintes serveur sur un message avant
// relais via Redis pub/sub :
//   - trim espaces invisibles
//   - taille (1..messageMaxLen)
//   - filtre obscénités
//
// La défense XSS côté client est assurée par DOMPurify + le rendu React
// en text node (jamais dangerouslySetInnerHTML — CLAUDE.md règle d'or #2).
// Le contenu *réel* du message n'est jamais loggé (règle #1).
func SanitizeAndCheck(raw string, block *Blocklist) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", ErrMessageEmpty
	}
	if utf8.RuneCountInString(trimmed) > messageMaxLen {
		return "", ErrMessageTooLong
	}
	if block.Contains(trimmed) {
		return "", ErrMessageBlocked
	}
	return trimmed, nil
}
