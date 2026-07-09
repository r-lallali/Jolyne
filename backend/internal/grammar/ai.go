package grammar

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"
)

// ReplyFunc : pont vers claudeapi.Client.Reply (sans historique — une
// vérification est un tour unique). Injectée plutôt que le type concret pour
// tester sans HTTP et garder le package grammar découplé de claudeapi.
type ReplyFunc func(ctx context.Context, system, userMsg string) (string, error)

// AIChecker corrige via Claude Haiku les langues du site que LanguageTool ne
// couvre pas (le coréen). Il produit les mêmes Match que le chemin LT : le
// frontend ne voit aucune différence.
//
// CLAUDE.md règle d'or #1 : le texte passe à l'API mais n'est JAMAIS loggé
// (claudeapi ne logge que les types d'erreur, jamais le payload).
type AIChecker struct {
	Reply ReplyFunc
}

func (a *AIChecker) Enabled() bool { return a != nil && a.Reply != nil }

// aiLangs : langues servies par l'IA faute de support LanguageTool. La clé
// est le code résolu par langAliases.
var aiLangs = map[string]struct{}{
	"ko": {},
}

// Le system prompt exige un objet JSON strict — un texte libre ferait
// échouer le parse et la requête tombe en « vérification indisponible ».
// Les consignes « ignore ponctuation finale / majuscules » répliquent les
// règles LT désactivées pour le contexte chat (disabledRules).
const aiCheckSystemPrompt = `Tu es un correcteur orthographique et grammatical pour un chat d'échange linguistique.
Réponds UNIQUEMENT avec un objet JSON compact, sans markdown ni commentaire :
{"errors":[{"wrong":"...","fixes":["..."],"note":"..."}]}
- wrong : l'extrait EXACT du texte contenant la faute, copié caractère pour caractère, le plus court possible.
- fixes : 1 à 5 corrections de cet extrait, de la plus probable à la moins probable.
- note : explication très courte de la faute, écrite dans la langue vérifiée.
Ne signale que de vraies fautes : orthographe, grammaire, particules, conjugaison, espacement.
Ignore le style familier, l'absence de ponctuation finale et de majuscule initiale.
Si le texte est correct : {"errors":[]}.`

// Plafond de fautes relayées — même esprit que la troncature des
// replacements côté LT : rester léger pour un message de chat.
const maxAIMatches = 10

type aiCheckResponse struct {
	Errors []aiError `json:"errors"`
}

type aiError struct {
	Wrong string   `json:"wrong"`
	Fixes []string `json:"fixes"`
	Note  string   `json:"note"`
}

// Check envoie le texte à Claude et renvoie les fautes au format Match.
// Toute réponse hors contrat (JSON invalide) est une erreur → 502 côté
// handler, comme une panne LanguageTool.
func (a *AIChecker) Check(ctx context.Context, text, lang string) ([]Match, error) {
	if !a.Enabled() {
		return nil, fmt.Errorf("grammar: ai désactivé")
	}
	user := fmt.Sprintf("Langue vérifiée : %s.\nTexte :\n%s", lang, text)
	raw, err := a.Reply(ctx, aiCheckSystemPrompt, user)
	if err != nil {
		return nil, fmt.Errorf("grammar: ai: %w", err)
	}
	parsed, err := parseAICheck(raw)
	if err != nil {
		return nil, err
	}
	return anchorMatches(text, parsed.Errors), nil
}

// parseAICheck extrait l'objet JSON de la réponse. Le prompt interdit le
// markdown mais on tolère des fences ou du texte parasite en isolant le
// premier '{' … dernier '}'.
func parseAICheck(raw string) (aiCheckResponse, error) {
	start := strings.IndexByte(raw, '{')
	end := strings.LastIndexByte(raw, '}')
	if start < 0 || end <= start {
		return aiCheckResponse{}, fmt.Errorf("grammar: ai: réponse sans objet JSON")
	}
	var out aiCheckResponse
	if err := json.Unmarshal([]byte(raw[start:end+1]), &out); err != nil {
		return aiCheckResponse{}, fmt.Errorf("grammar: ai: parse: %w", err)
	}
	return out, nil
}

// anchorMatches ancre chaque faute signalée dans le texte original et
// calcule offset/length en unités UTF-16 — les mêmes unités que LanguageTool
// (chars Java) et que String.slice côté frontend. Une faute dont l'extrait
// ne se retrouve pas tel quel dans le texte est ignorée (hallucination).
func anchorMatches(text string, errs []aiError) []Match {
	matches := make([]Match, 0, len(errs))
	// Curseur de recherche en bytes : les fautes arrivent en ordre de
	// lecture, chercher après la précédente désambiguïse les doublons.
	cursor := 0
	for _, e := range errs {
		if len(matches) >= maxAIMatches {
			break
		}
		if e.Wrong == "" || !utf8.ValidString(e.Wrong) {
			continue
		}
		idx := strings.Index(text[cursor:], e.Wrong)
		if idx >= 0 {
			idx += cursor
		} else if idx = strings.Index(text, e.Wrong); idx < 0 {
			continue
		}

		repl := make([]string, 0, len(e.Fixes))
		for _, f := range e.Fixes {
			if f = strings.TrimSpace(f); f == "" || f == e.Wrong {
				continue
			}
			repl = append(repl, f)
			if len(repl) == 5 {
				break
			}
		}
		note := strings.TrimSpace(e.Note)
		// Ni correction ni explication : rien d'actionnable à afficher.
		if len(repl) == 0 && note == "" {
			continue
		}

		matches = append(matches, Match{
			Message:      note,
			Offset:       utf16Len(text[:idx]),
			Length:       utf16Len(e.Wrong),
			Replacements: repl,
		})
		if next := idx + len(e.Wrong); next > cursor {
			cursor = next
		}
	}
	return matches
}

// utf16Len : longueur de s en unités de code UTF-16 (les runes hors BMP,
// emoji par exemple, comptent double — comme dans une string JavaScript).
func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		if r > 0xFFFF {
			n += 2
		} else {
			n++
		}
	}
	return n
}
