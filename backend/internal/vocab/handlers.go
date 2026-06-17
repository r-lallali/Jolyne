package vocab

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ralys/jolyne/backend/internal/users"
)

// Langues acceptées pour la paire d'une entrée. Aligné sur le handler
// translate (mêmes codes), mais 'auto' est exclu : une entrée figée doit
// porter une langue source résolue.
var allowedLangs = map[string]struct{}{
	"fr": {}, "en": {}, "es": {}, "de": {}, "pt": {}, "it": {},
	"zh": {}, "ja": {}, "ko": {}, "ar": {},
}

// Handlers : endpoints /api/vocab. Toutes les routes passent par RequireAuth
// (le user est dans le ctx). Le Store est obligatoire.
type Handlers struct {
	Store *Store
	Log   *slog.Logger
}

func (h *Handlers) log() *slog.Logger {
	if h.Log != nil {
		return h.Log
	}
	return slog.Default()
}

// HandleList : GET /api/vocab. Renvoie tout le carnet du user.
func (h *Handlers) HandleList(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	entries, err := h.Store.List(ctx, user.ID)
	if err != nil {
		h.log().Error("vocab list", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"entries": entries})
}

type createBody struct {
	Term        string `json:"term"`
	Translation string `json:"translation"`
	SourceLang  string `json:"source_lang"`
	TargetLang  string `json:"target_lang"`
}

// HandleCreate : POST /api/vocab. Sauvegarde un mot depuis le popover. Pas de
// quota : le coût de stockage est négligeable et l'usage est borné par la
// nature du geste (sélection manuelle). Idempotent côté store.
func (h *Handlers) HandleCreate(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	var body createBody
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024)).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	body.SourceLang = strings.ToLower(strings.TrimSpace(body.SourceLang))
	body.TargetLang = strings.ToLower(strings.TrimSpace(body.TargetLang))
	if _, ok := allowedLangs[body.SourceLang]; !ok {
		http.Error(w, "invalid source", http.StatusBadRequest)
		return
	}
	if _, ok := allowedLangs[body.TargetLang]; !ok {
		http.Error(w, "invalid target", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	entry, err := h.Store.Add(ctx, user.ID, Entry{
		Term:        body.Term,
		Translation: body.Translation,
		SourceLang:  body.SourceLang,
		TargetLang:  body.TargetLang,
	})
	if err != nil {
		// term/translation vides après sanitize → 400 ; le reste → 500.
		if strings.Contains(err.Error(), "required") {
			http.Error(w, "term and translation required", http.StatusBadRequest)
			return
		}
		h.log().Error("vocab create", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(entry)
}

// HandleDelete : DELETE /api/vocab/{id}. Le store filtre par user_id (pas
// d'IDOR). 204 même si déjà absent côté front (idempotence d'UX).
func (h *Handlers) HandleDelete(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	idStr := strings.TrimPrefix(r.URL.Path, "/api/vocab/")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := h.Store.Delete(ctx, user.ID, id); err != nil && !errors.Is(err, ErrNotFound) {
		h.log().Error("vocab delete", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
