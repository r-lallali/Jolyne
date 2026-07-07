package translate

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// ReplyFunc : pont vers claudeapi.Client.Reply (sans historique — une
// traduction est un tour unique). Injectée plutôt que le type concret pour
// tester sans HTTP et garder le package translate découplé de claudeapi.
type ReplyFunc func(ctx context.Context, system, userMsg string) (string, error)

// AITranslator traduit les PHRASES via Claude Haiku — LibreTranslate (Argos,
// pivot anglais) reste sur les mots isolés où il est instantané et suffisant.
// Bonus IA : détection fiable de la langue source et romanisation (pinyin,
// rōmaji, RR, translittération arabe) pour les scripts non latins.
//
// CLAUDE.md règle d'or #1 : le texte passe à l'API mais n'est JAMAIS loggé
// (claudeapi ne logge que les types d'erreur, jamais le payload).
type AITranslator struct {
	Reply ReplyFunc
}

func (a *AITranslator) Enabled() bool { return a != nil && a.Reply != nil }

// Langues à script non latin pour lesquelles on attend une romanisation.
var romanizableLangs = map[string]struct{}{
	"zh": {}, "ja": {}, "ko": {}, "ar": {},
}

// Le system prompt exige un objet JSON strict — un texte libre ferait
// échouer le parse et on retomberait sur LibreTranslate (fallback handler).
const aiSystemPrompt = `Tu es un moteur de traduction pour une application d'échange linguistique.
Réponds UNIQUEMENT avec un objet JSON compact, sans markdown ni commentaire :
{"translation":"...","detected":"xx","romanization":"..."}
- translation : traduction naturelle et idiomatique du texte vers la langue cible.
- detected : code ISO 639-1 de la langue RÉELLE du texte source (la langue annoncée peut être fausse).
- romanization : romanisation standard du texte SOURCE (pinyin pour zh, rōmaji Hepburn pour ja, romanisation révisée pour ko, translittération pour ar) si sa langue s'écrit en script non latin, sinon "".
Si le texte est déjà dans la langue cible, translation = le texte inchangé.`

type aiResponse struct {
	Translation  string `json:"translation"`
	Detected     string `json:"detected"`
	Romanization string `json:"romanization"`
}

// Translate envoie le texte à Claude et renvoie traduction + langue détectée
// + romanisation éventuelle. `source` peut être "auto" — l'IA détecte de
// toute façon. Toute réponse hors contrat (JSON invalide, traduction vide)
// est une erreur : le handler retombe sur LibreTranslate.
func (a *AITranslator) Translate(ctx context.Context, text, source, target string) (Result, error) {
	if !a.Enabled() {
		return Result{}, fmt.Errorf("translate: ai désactivé")
	}
	user := fmt.Sprintf(
		"Langue source annoncée : %s (peut être erronée). Langue cible : %s.\nTexte :\n%s",
		source, target, text,
	)
	raw, err := a.Reply(ctx, aiSystemPrompt, user)
	if err != nil {
		return Result{}, fmt.Errorf("translate: ai: %w", err)
	}
	parsed, err := parseAIResponse(raw)
	if err != nil {
		return Result{}, err
	}
	res := Result{Translated: parsed.Translation}
	// Detected : on ne relaie que les codes du site — un code fantaisiste
	// serait ensuite persisté dans le carnet de vocab.
	detected := strings.ToLower(strings.TrimSpace(parsed.Detected))
	if _, ok := allowedLangs[detected]; ok && detected != "auto" {
		res.Detected = detected
	}
	// Romanisation : uniquement pertinente pour les scripts non latins. On
	// borne aussi sa taille — une hallucination fleuve ne doit pas gonfler
	// la réponse ni le cache.
	lang := res.Detected
	if lang == "" && source != "auto" {
		lang = source
	}
	if _, ok := romanizableLangs[lang]; ok {
		if r := strings.TrimSpace(parsed.Romanization); len(r) <= 2*len(text)+64 {
			res.Romanization = r
		}
	}
	return res, nil
}

// parseAIResponse extrait l'objet JSON de la réponse. Le prompt interdit le
// markdown mais on tolère des fences ou du texte parasite en isolant le
// premier '{' … dernier '}'.
func parseAIResponse(raw string) (aiResponse, error) {
	start := strings.IndexByte(raw, '{')
	end := strings.LastIndexByte(raw, '}')
	if start < 0 || end <= start {
		return aiResponse{}, fmt.Errorf("translate: ai: réponse sans objet JSON")
	}
	var out aiResponse
	if err := json.Unmarshal([]byte(raw[start:end+1]), &out); err != nil {
		return aiResponse{}, fmt.Errorf("translate: ai: parse: %w", err)
	}
	if strings.TrimSpace(out.Translation) == "" {
		return aiResponse{}, fmt.Errorf("translate: ai: traduction vide")
	}
	out.Translation = strings.TrimSpace(out.Translation)
	return out, nil
}
