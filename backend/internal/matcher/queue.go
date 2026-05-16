package matcher

import (
	"errors"
	"fmt"
)

// LangCode est un code ISO 639-1 minuscule. Phase 1 supporte 4 paires :
// FR↔EN, ES↔EN, DE↔EN, FR↔ES (cf. PLAN.md §8).
type LangCode string

const (
	FR LangCode = "fr"
	EN LangCode = "en"
	ES LangCode = "es"
	DE LangCode = "de"
)

var allowedPairs = map[string]struct{}{
	"fr|en": {}, "en|fr": {},
	"es|en": {}, "en|es": {},
	"de|en": {}, "en|de": {},
	"fr|es": {}, "es|fr": {},
}

var (
	ErrInvalidLang = errors.New("matcher: code langue invalide")
	ErrSameLang    = errors.New("matcher: speaks et wants identiques")
	ErrPairNotOpen = errors.New("matcher: paire de langues non ouverte au lancement")
)

func ValidatePair(speaks, wants LangCode) error {
	if !isValidLang(speaks) || !isValidLang(wants) {
		return ErrInvalidLang
	}
	if speaks == wants {
		return ErrSameLang
	}
	if _, ok := allowedPairs[string(speaks)+"|"+string(wants)]; !ok {
		return ErrPairNotOpen
	}
	return nil
}

func isValidLang(l LangCode) bool {
	switch l {
	case FR, EN, ES, DE:
		return true
	}
	return false
}

// queueOwn renvoie la clé Redis où l'on s'inscrit en attendant un peer.
func queueOwn(speaks, wants LangCode) string {
	return fmt.Sprintf("queue:speaks=%s,wants=%s", speaks, wants)
}

// queueTarget renvoie la clé Redis où l'on cherche un peer compatible (le
// miroir : il parle ce qu'on veut et veut ce qu'on parle).
func queueTarget(speaks, wants LangCode) string {
	return fmt.Sprintf("queue:speaks=%s,wants=%s", wants, speaks)
}

// QueueTargetKey est l'export public de queueTarget — utilisé par l'API
// publique /api/queue-size pour exposer "X peers compatibles en attente".
func QueueTargetKey(speaks, wants LangCode) string {
	return queueTarget(speaks, wants)
}
