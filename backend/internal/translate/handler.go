package translate

import (
	"encoding/json"
	"net/http"
	"strings"
	"unicode/utf8"
)

// Limite de payload défensive. La traduction côté UI cible un mot ou une
// phrase courte sélectionnée par le user — pas un roman.
const maxTextRunes = 500

// Liste des langues supportées au lancement (cf. PLAN.md §8 : 4 paires
// FR↔EN, ES↔EN, DE↔EN, FR↔ES). On accepte aussi `auto` pour la source.
var allowedLangs = map[string]struct{}{
	"auto": {}, "fr": {}, "en": {}, "es": {}, "de": {},
}

type translateReq struct {
	Text   string `json:"text"`
	Source string `json:"source"`
	Target string `json:"target"`
}

type translateResp struct {
	Translated string `json:"translated"`
}

// Handler expose POST /api/translate. Body JSON {text, source, target}.
// Aucun quota au lancement (cf. décision actée — on en remettra un plus tard).
type Handler struct {
	Client *Client
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body translateReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024)).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	body.Text = strings.TrimSpace(body.Text)
	body.Source = strings.ToLower(strings.TrimSpace(body.Source))
	body.Target = strings.ToLower(strings.TrimSpace(body.Target))

	if body.Text == "" {
		http.Error(w, "text required", http.StatusBadRequest)
		return
	}
	if utf8.RuneCountInString(body.Text) > maxTextRunes {
		http.Error(w, "text too long", http.StatusBadRequest)
		return
	}
	if _, ok := allowedLangs[body.Source]; !ok {
		http.Error(w, "invalid source", http.StatusBadRequest)
		return
	}
	if body.Target == "auto" {
		http.Error(w, "invalid target", http.StatusBadRequest)
		return
	}
	if _, ok := allowedLangs[body.Target]; !ok {
		http.Error(w, "invalid target", http.StatusBadRequest)
		return
	}

	translated, err := h.Client.Translate(r.Context(), body.Text, body.Source, body.Target)
	if err != nil {
		http.Error(w, "translation unavailable", http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(translateResp{Translated: translated})
}
