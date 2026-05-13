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
	return params{nick: nick, speaks: speaks, wants: wants, fingerprint: fp}, nil
}

// ageAccepted exige une valeur explicite "ok" (case-insensitive). La simple
// présence de la checkbox côté UI ne suffit pas — voir CLAUDE.md règle #9.
func ageAccepted(v string) bool {
	return strings.EqualFold(strings.TrimSpace(v), "ok")
}
