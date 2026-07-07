package ws

import (
	"html"
	"unicode/utf8"

	"github.com/abadojack/whatlanggo"
)

// Détection de langue 100 % offline (trigrammes whatlanggo) : aucun contenu ne
// sort du serveur, rien n'est loggé ni persisté (règle d'or #1). Sert au
// « nudge » pédagogique : si l'apprenant enchaîne les messages dans SA langue
// au lieu de celle qu'il est venu pratiquer, on lui glisse un rappel discret —
// visible uniquement de son côté, jamais du peer.

const (
	// nudgeMinRunes : en-deçà, le message est ignoré (détection non fiable sur
	// les textes courts, et « ok », « jaja » sont légitimes dans toute langue).
	nudgeMinRunes = 15
	// nudgeThreshold : nombre de messages consécutifs détectés dans la langue
	// native avant d'émettre le rappel.
	nudgeThreshold = 6
	// nudgeTandemThreshold : seuil resserré pendant une session tandem 50/50
	// (la moitié en cours impose explicitement sa langue).
	nudgeTandemThreshold = 3
	// nudgeMinConfidence : confiance minimale pour retenir une détection. Le
	// IsReliable() de whatlanggo (0.8) est trop strict pour les langues romanes
	// proches (es/pt/it plafonnent souvent à ~0.6 sur une phrase de chat) — le
	// nudge serait quasi inerte sur ces paires. 0.5 suffit ici : une erreur
	// isolée est sans effet, il faut nudgeThreshold détections CONSÉCUTIVES
	// dans la langue native pour déclencher.
	nudgeMinConfidence = 0.5
)

// nudgeLangs : nos 10 codes ISO 639-1 → Lang whatlanggo. La whitelist
// restreint la classification aux langues du produit (précision accrue).
var nudgeLangs = map[string]whatlanggo.Lang{
	"fr": whatlanggo.Fra,
	"en": whatlanggo.Eng,
	"es": whatlanggo.Spa,
	"de": whatlanggo.Deu,
	"pt": whatlanggo.Por,
	"it": whatlanggo.Ita,
	"zh": whatlanggo.Cmn,
	"ja": whatlanggo.Jpn,
	"ko": whatlanggo.Kor,
	"ar": whatlanggo.Arb,
}

var nudgeWhitelist = buildNudgeWhitelist()

func buildNudgeWhitelist() map[whatlanggo.Lang]bool {
	m := make(map[whatlanggo.Lang]bool, len(nudgeLangs))
	for _, l := range nudgeLangs {
		m[l] = true
	}
	return m
}

// detectLang classe un texte parmi les 10 langues supportées. Renvoie "" si la
// détection n'est pas assez sûre (texte court, langue hors produit, mélange).
func detectLang(text string) string {
	info := whatlanggo.DetectWithOptions(text, whatlanggo.Options{Whitelist: nudgeWhitelist})
	if info.Confidence < nudgeMinConfidence {
		return ""
	}
	for code, l := range nudgeLangs {
		if l == info.Lang {
			return code
		}
	}
	return ""
}

// langNudge suit, côté serveur et par conversation, la langue des messages
// envoyés par l'utilisateur. État purement en mémoire sur la durée de
// runChat — rien ne fuit hors du process.
type langNudge struct {
	speaks string // langue native de l'utilisateur
	wants  string // langue qu'il est venu pratiquer
	streak int    // messages consécutifs détectés en `speaks`
	sent   bool   // rappel déjà émis (max 1 par conversation)

	// tandem : pendant une phase 50/50, la langue attendue est imposée par la
	// phase courante ("" = pas de session tandem). Le compteur repart à zéro à
	// chaque changement de phase, et le rappel tandem est ré-armable (un par
	// phase, seuil court).
	tandemLang string
	tandemSent bool
}

func newLangNudge(speaks, wants string) *langNudge {
	return &langNudge{speaks: speaks, wants: wants}
}

// setTandemLang (re)configure la langue attendue de la phase tandem courante.
// Appelé au début de session tandem et à chaque switch. lang vide = fin de
// session (retour au mode nudge standard).
func (n *langNudge) setTandemLang(lang string) {
	n.tandemLang = lang
	n.streak = 0
	n.tandemSent = false
}

// observe analyse un message sortant (body encore HTML-escapé) et renvoie le
// code de nudge à émettre — "" si rien à signaler. Au plus un nudge standard
// par conversation, un nudge tandem par phase.
func (n *langNudge) observe(escapedBody string) string {
	text := html.UnescapeString(escapedBody)
	if utf8.RuneCountInString(text) < nudgeMinRunes {
		return ""
	}
	detected := detectLang(text)
	if detected == "" {
		return ""
	}

	// Mode tandem : la langue attendue est celle de la phase courante.
	if n.tandemLang != "" {
		if detected == n.tandemLang {
			n.streak = 0
			return ""
		}
		n.streak++
		if !n.tandemSent && n.streak >= nudgeTandemThreshold {
			n.tandemSent = true
			n.streak = 0
			return NudgeTandemLang
		}
		return ""
	}

	// Mode standard : on ne compte que les messages clairement écrits dans la
	// langue native ; un message dans la langue cible remet le compteur à zéro,
	// les autres langues / détections ambiguës ne changent rien.
	switch detected {
	case n.wants:
		n.streak = 0
	case n.speaks:
		n.streak++
		if !n.sent && n.streak >= nudgeThreshold {
			n.sent = true
			return NudgePracticeLang
		}
	}
	return ""
}
