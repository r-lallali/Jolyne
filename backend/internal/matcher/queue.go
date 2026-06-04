package matcher

import (
	"errors"
	"fmt"
)

// LangCode est un code ISO 639-1 minuscule. Toutes les paires de langues
// distinctes parmi allLangs sont ouvertes.
type LangCode string

const (
	FR LangCode = "fr"
	EN LangCode = "en"
	ES LangCode = "es"
	DE LangCode = "de"
	PT LangCode = "pt"
	IT LangCode = "it"
	ZH LangCode = "zh"
	JA LangCode = "ja"
	KO LangCode = "ko"
	AR LangCode = "ar"
)

// allLangs : ordre de référence des langues supportées. Source unique pour
// la validation et la génération des paires ouvertes.
var allLangs = []LangCode{FR, EN, ES, DE, PT, IT, ZH, JA, KO, AR}

// allowedPairs contient toutes les paires (speaks, wants) de langues
// distinctes. Généré depuis allLangs pour rester aligné quand on ajoute
// une langue.
var allowedPairs = buildAllowedPairs()

func buildAllowedPairs() map[string]struct{} {
	m := make(map[string]struct{}, len(allLangs)*(len(allLangs)-1))
	for _, s := range allLangs {
		for _, w := range allLangs {
			if s != w {
				m[string(s)+"|"+string(w)] = struct{}{}
			}
		}
	}
	return m
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
	for _, x := range allLangs {
		if x == l {
			return true
		}
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
