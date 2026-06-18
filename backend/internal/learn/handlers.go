package learn

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

// Handlers : endpoints /api/learn/*. Toutes les routes passent par RequireAuth
// (le mode Cours est réservé aux comptes — il faut un user_id pour la
// progression et le streak). Le Store est obligatoire.
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

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// HandleListCourses : GET /api/learn/courses — cours disponibles.
func (h *Handlers) HandleListCourses(w http.ResponseWriter, r *http.Request) {
	if _, ok := users.CurrentUser(r.Context()); !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	courses, err := h.Store.ListCourses(ctx)
	if err != nil {
		h.log().Error("learn list courses", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"courses": courses})
}

// HandleTree : GET /api/learn/courses/{lang} — arbre du cours + progression.
func (h *Handlers) HandleTree(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	lang := strings.ToLower(strings.TrimPrefix(r.URL.Path, "/api/learn/courses/"))
	if !IsSupportedLang(lang) {
		http.Error(w, "invalid lang", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	tree, err := h.Store.Tree(ctx, lang, user.ID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			http.Error(w, "course not found", http.StatusNotFound)
			return
		}
		h.log().Error("learn tree", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, tree)
}

// HandleLessonPlay : GET /api/learn/lessons/{id}?from=fr — items résolus.
func (h *Handlers) HandleLessonPlay(w http.ResponseWriter, r *http.Request) {
	if _, ok := users.CurrentUser(r.Context()); !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	id, ok := lessonIDFromPath(r.URL.Path)
	if !ok {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	from := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("from")))
	if !IsSupportedLang(from) {
		from = "en"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	lp, err := h.Store.LessonForPlay(ctx, id, from)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			http.Error(w, "lesson not found", http.StatusNotFound)
			return
		}
		h.log().Error("learn lesson play", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, lp)
}

type completeBody struct {
	Mistakes int `json:"mistakes"`
}

// HandleComplete : POST /api/learn/lessons/{id}/complete — valide la leçon.
func (h *Handlers) HandleComplete(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	id, ok := lessonIDFromCompletePath(r.URL.Path)
	if !ok {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	var body completeBody
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if body.Mistakes < 0 {
		body.Mistakes = 0
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	res, err := h.Store.CompleteLesson(ctx, user.ID, id, body.Mistakes, time.Now())
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			http.Error(w, "lesson not found", http.StatusNotFound)
			return
		}
		h.log().Error("learn complete", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// HandleState : GET /api/learn/state — état de gamification courant.
func (h *Handlers) HandleState(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	st, err := h.Store.State(ctx, user.ID, time.Now())
	if err != nil {
		h.log().Error("learn state", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

type goalBody struct {
	Goal int64 `json:"goal"`
}

// HandleSetGoal : PUT /api/learn/state/daily-goal — règle l'objectif quotidien.
func (h *Handlers) HandleSetGoal(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	var body goalBody
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256)).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := h.Store.SetDailyGoal(ctx, user.ID, body.Goal); err != nil {
		h.log().Error("learn set goal", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	st, err := h.Store.State(ctx, user.ID, time.Now())
	if err != nil {
		h.log().Error("learn state", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// lessonIDFromPath : extrait {id} de /api/learn/lessons/{id}.
func lessonIDFromPath(path string) (int64, bool) {
	rest := strings.TrimPrefix(path, "/api/learn/lessons/")
	id, err := strconv.ParseInt(rest, 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

// lessonIDFromCompletePath : extrait {id} de /api/learn/lessons/{id}/complete.
func lessonIDFromCompletePath(path string) (int64, bool) {
	rest := strings.TrimPrefix(path, "/api/learn/lessons/")
	rest = strings.TrimSuffix(rest, "/complete")
	id, err := strconv.ParseInt(rest, 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}
