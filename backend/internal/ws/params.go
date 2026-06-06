package ws

import (
	"errors"
	"net/http"
	"strings"

	"github.com/ralys/jolyne/backend/internal/matcher"
)

type params struct {
	nick        string
	speaks      matcher.LangCode
	wants       matcher.LangCode
	fingerprint string
	// botMode : le user a choisi le mode "Prof IA" sur l'écran de setup. On
	// saute le matching humain et on lance directement un bot prof IA.
	botMode bool
}

func parseParams(r *http.Request) (params, error) {
	q := r.URL.Query()
	if !ageAccepted(q.Get("age")) {
		return params{}, errors.New("age_gate non accepté")
	}
	fp := strings.TrimSpace(q.Get("fp"))
	if fp == "" {
		return params{}, errors.New("fingerprint manquant")
	}
	nick := strings.TrimSpace(q.Get("nick"))
	if nick == "" {
		return params{}, errors.New("pseudo manquant")
	}
	speaks := matcher.LangCode(strings.ToLower(strings.TrimSpace(q.Get("speaks"))))
	wants := matcher.LangCode(strings.ToLower(strings.TrimSpace(q.Get("wants"))))
	return params{
		nick:        nick,
		speaks:      speaks,
		wants:       wants,
		fingerprint: fp,
		botMode:     botModeRequested(q.Get("bot")),
	}, nil
}

// botModeRequested : true si le client a demandé le mode prof IA direct
// (?bot=1). Accepte "1" ou "true" (case-insensitive). Toute autre valeur
// (ou absence) = matching humain normal.
func botModeRequested(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true":
		return true
	default:
		return false
	}
}

// ageAccepted exige une valeur explicite "ok" (case-insensitive). La simple
// présence de la checkbox côté UI ne suffit pas — voir CLAUDE.md règle #9.
func ageAccepted(v string) bool {
	return strings.EqualFold(strings.TrimSpace(v), "ok")
}
