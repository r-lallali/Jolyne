package moderation

import (
	"errors"
	"html"
	"strings"
	"unicode/utf8"
)

const messageMaxLen = 2000

var (
	ErrMessageEmpty   = errors.New("message vide")
	ErrMessageTooLong = errors.New("message trop long")
	ErrMessageBlocked = errors.New("message refusé par le filtre")
)

// SanitizeAndCheck applique les contraintes appliquées à un message de chat
// avant relais via Redis pub/sub :
//   - trim espaces invisibles
//   - taille (1..messageMaxLen)
//   - filtre obscénités
//   - échappement HTML (CLAUDE.md règle d'or #2 — XSS aller-retour)
//
// Le contenu *réel* du message n'est jamais loggé. Voir CLAUDE.md règle #1.
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
	return html.EscapeString(trimmed), nil
}
