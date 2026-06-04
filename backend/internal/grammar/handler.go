package grammar

import (
	"encoding/json"
	"net/http"
	"strings"
	"unicode/utf8"
)

const maxTextRunes = 2000

// Codes BCP-47 acceptés. On accepte le code court (ex: "fr") en plus du
// long (ex: "fr-FR") pour coller au format `lang` qu'envoie le frontend
// quand l'utilisateur choisit sa langue. Les langues non gérées par
// LanguageTool (ex: le coréen) sont volontairement absentes : la requête
// retourne alors 400 et le frontend dégrade en « vérification indisponible ».
var langAliases = map[string]string{
	"fr":    "fr",
	"fr-fr": "fr-FR",
	"en":    "en-US",
	"en-us": "en-US",
	"en-gb": "en-GB",
	"es":    "es",
	"de":    "de-DE",
	"de-de": "de-DE",
	"pt":    "pt-PT",
	"pt-pt": "pt-PT",
	"pt-br": "pt-BR",
	"it":    "it",
	"ar":    "ar",
	"zh":    "zh-CN",
	"zh-cn": "zh-CN",
	"ja":    "ja-JP",
	"ja-jp": "ja-JP",
}

type checkReq struct {
	Text string `json:"text"`
	Lang string `json:"lang"`
}

type checkResp struct {
	Matches []Match `json:"matches"`
}

// Handler expose POST /api/grammar. Body JSON {text, lang}. Pas de quota au
// lancement — l'appel est déclenché manuellement par le user (bouton).
type Handler struct {
	Client *Client
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body checkReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	body.Text = strings.TrimSpace(body.Text)
	if body.Text == "" {
		http.Error(w, "text required", http.StatusBadRequest)
		return
	}
	if utf8.RuneCountInString(body.Text) > maxTextRunes {
		http.Error(w, "text too long", http.StatusBadRequest)
		return
	}

	lang, ok := langAliases[strings.ToLower(strings.TrimSpace(body.Lang))]
	if !ok {
		http.Error(w, "invalid lang", http.StatusBadRequest)
		return
	}

	matches, err := h.Client.Check(r.Context(), body.Text, lang)
	if err != nil {
		http.Error(w, "grammar unavailable", http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(checkResp{Matches: matches})
}
