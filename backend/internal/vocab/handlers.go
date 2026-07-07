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

	"github.com/ralys/jolyne/backend/internal/analytics"
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
// (le user est dans le ctx). Le Store est obligatoire ; Tracker optionnel
// (event srs_review_done).
type Handlers struct {
	Store   *Store
	Tracker *analytics.Tracker
	Log     *slog.Logger
}

// reviewBatchSize : cartes servies par GET /api/vocab/review. Une session de
// révision courte — le client redemande s'il finit la pile.
const reviewBatchSize = 20

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

// HandleReviewList : GET /api/vocab/review. Renvoie la pile de cartes dues
// (bornée à reviewBatchSize) + le total dû.
func (h *Handlers) HandleReviewList(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	entries, total, err := h.Store.Due(ctx, user.ID, reviewBatchSize)
	if err != nil {
		h.log().Error("vocab review list", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"entries": entries, "total_due": total})
}

type reviewBody struct {
	Grade string `json:"grade"`
}

// HandleReviewGrade : POST /api/vocab/{id}/review {grade}. Applique la note
// SM-2 et renvoie la prochaine échéance.
func (h *Handlers) HandleReviewGrade(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	idStr := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/vocab/"), "/review")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	var body reviewBody
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512)).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	grade := Grade(strings.ToLower(strings.TrimSpace(body.Grade)))
	if !ValidGrade(grade) {
		http.Error(w, "invalid grade", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	dueAt, err := h.Store.ApplyReview(ctx, user.ID, id, grade, time.Now())
	if errors.Is(err, ErrNotFound) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		h.log().Error("vocab review grade", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	h.Tracker.Emit(analytics.Event{
		Name:   analytics.EventSRSReviewDone,
		UserID: user.ID,
		Props:  map[string]any{"grade": string(grade)},
	})
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "due_at": dueAt})
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
