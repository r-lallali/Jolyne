package translate

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/ralys/jolyne/backend/internal/quota"
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
// Quota Free = 10 traductions/jour par identité (userID si connecté, sinon
// fingerprint via l'en-tête X-Device-FP). Premium = illimité.
type Handler struct {
	Client *Client
	Quota  *quota.Engine
	// ResolveUserID résout le cookie de session → userID (0 si anonyme).
	// IsPremium dit si ce user a un abonnement actif. Tous deux optionnels :
	// nil → comportement anonyme / non-premium.
	ResolveUserID func(r *http.Request) int64
	IsPremium     func(ctx context.Context, userID int64) bool
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

	// Quota : on bloque AVANT l'appel upstream si la limite est atteinte, et on
	// ne décompte un crédit qu'en cas de succès (pas sur un 502 LibreTranslate).
	userID := int64(0)
	if h.ResolveUserID != nil {
		userID = h.ResolveUserID(r)
	}
	premium := userID > 0 && h.IsPremium != nil && h.IsPremium(r.Context(), userID)
	quotaID := quota.Identity(userID, strings.TrimSpace(r.Header.Get("X-Device-FP")))
	if !premium && h.Quota != nil && quotaID != "" {
		if used, err := h.Quota.Used(r.Context(), quota.KindTranslate, quotaID); err == nil &&
			used >= quota.FreeTranslateDaily {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			_ = json.NewEncoder(w).Encode(map[string]string{"code": "quota_exceeded"})
			return
		}
	}

	translated, err := h.Client.Translate(r.Context(), body.Text, body.Source, body.Target)
	if err != nil {
		http.Error(w, "translation unavailable", http.StatusBadGateway)
		return
	}

	// Succès → on décompte (max=0 : simple incrément, le plafond a déjà été
	// vérifié au pré-check ci-dessus).
	if !premium && h.Quota != nil && quotaID != "" {
		_, _ = h.Quota.CheckAndIncrement(r.Context(), quota.KindTranslate, quotaID, 0)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(translateResp{Translated: translated})
}
