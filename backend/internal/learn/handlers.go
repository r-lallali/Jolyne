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

	"github.com/ralys/jolyne/backend/internal/friends"
	"github.com/ralys/jolyne/backend/internal/push"
	"github.com/ralys/jolyne/backend/internal/users"
)

// Handlers : endpoints /api/learn/*. Toutes les routes passent par RequireAuth
// (le mode Cours est réservé aux comptes — il faut un user_id pour la
// progression et le streak). Le Store est obligatoire.
type Handlers struct {
	Store *Store
	// IsPremium : résout le plan de l'apprenant (cœurs illimités). nil = jamais
	// premium.
	IsPremium func(ctx context.Context, userID int64) bool
	// Friends : pour valider l'amitié avant une demande de cœur. nil = pas de
	// vérification (les demandes de cœur sont alors désactivées).
	Friends *friends.Store
	// Push : notifications best-effort (demande / don de cœur). nil = silencieux.
	Push *push.Sender
	Log  *slog.Logger
}

func (h *Handlers) premium(ctx context.Context, userID int64) bool {
	return h.IsPremium != nil && h.IsPremium(ctx, userID)
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

// HandleLessonPlay : GET /api/learn/lessons/{id}?from=fr — items résolus,
// enrichis des mots du carnet de l'apprenant adaptés au niveau.
func (h *Handlers) HandleLessonPlay(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
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
	lp, err := h.Store.LessonForPlay(ctx, id, user.ID, from)
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
	Mistakes int  `json:"mistakes"`
	Failed   bool `json:"failed"`
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
	premium := h.premium(ctx, user.ID)
	res, err := h.Store.CompleteLesson(ctx, user.ID, id, body.Mistakes, premium, body.Failed, time.Now())
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
	st, err := h.Store.State(ctx, user.ID, h.premium(ctx, user.ID), time.Now())
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
	st, err := h.Store.State(ctx, user.ID, h.premium(ctx, user.ID), time.Now())
	if err != nil {
		h.log().Error("learn state", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

type placementBody struct {
	StartUnit int `json:"start_unit"`
}

// HandlePlacement : POST /api/learn/courses/{lang}/placement — inscrit
// l'apprenant à un niveau de départ (saute les unités antérieures). Renvoie
// l'arbre mis à jour.
func (h *Handlers) HandlePlacement(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/api/learn/courses/")
	lang := strings.ToLower(strings.TrimSuffix(rest, "/placement"))
	if !IsSupportedLang(lang) {
		http.Error(w, "invalid lang", http.StatusBadRequest)
		return
	}
	var body placementBody
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256)).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	if err := h.Store.Enroll(ctx, user.ID, lang, body.StartUnit); err != nil {
		if errors.Is(err, ErrNotFound) {
			http.Error(w, "course not found", http.StatusNotFound)
			return
		}
		h.log().Error("learn placement", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	tree, err := h.Store.Tree(ctx, lang, user.ID)
	if err != nil {
		h.log().Error("learn placement tree", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, tree)
}

type requestHeartBody struct {
	FriendUserID int64 `json:"friend_user_id"`
}

// HandleRequestHeart : POST /api/learn/hearts/request — demande un cœur à un
// ami (1/jour). Vérifie l'amitié et le quota, puis notifie l'ami.
func (h *Handlers) HandleRequestHeart(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	if h.Friends == nil {
		http.Error(w, "friends disabled", http.StatusServiceUnavailable)
		return
	}
	var body requestHeartBody
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256)).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if body.FriendUserID == user.ID || body.FriendUserID <= 0 {
		http.Error(w, "invalid friend", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	isFriend, err := h.Friends.IsFriend(ctx, user.ID, body.FriendUserID)
	if err != nil {
		h.log().Error("learn heart friend check", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	if !isFriend {
		http.Error(w, "not a friend", http.StatusForbidden)
		return
	}
	id, code, err := h.Store.CreateHeartRequest(ctx, user.ID, body.FriendUserID, time.Now())
	if err != nil {
		h.log().Error("learn heart request", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	if code == "quota" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "quota"})
		return
	}
	// Notifie l'ami (best-effort, hors requête).
	if h.Push != nil {
		go h.Push.SendToUser(context.Background(), body.FriendUserID, push.Payload{
			Title: "Jolyne",
			Body:  "Un ami te demande un cœur ❤️",
			URL:   "/learn",
			Tag:   "learn-heart",
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id})
}

// HandleListHeartRequests : GET /api/learn/hearts/requests — demandes reçues.
func (h *Handlers) HandleListHeartRequests(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	reqs, err := h.Store.ListIncomingHeartRequests(ctx, user.ID)
	if err != nil {
		h.log().Error("learn heart list", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"requests": reqs})
}

// HandleGrantHeart : POST /api/learn/hearts/requests/{id}/grant — accorde la
// demande et offre +1 cœur au demandeur.
func (h *Handlers) HandleGrantHeart(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/api/learn/hearts/requests/")
	rest = strings.TrimSuffix(rest, "/grant")
	id, err := strconv.ParseInt(rest, 10, 64)
	if err != nil || id <= 0 {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	requesterID, granted, err := h.Store.GrantHeart(ctx, user.ID, id, time.Now())
	if err != nil {
		h.log().Error("learn heart grant", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	if granted && h.Push != nil {
		go h.Push.SendToUser(context.Background(), requesterID, push.Payload{
			Title: "Jolyne",
			Body:  "Un ami t'a offert un cœur ❤️",
			URL:   "/learn",
			Tag:   "learn-heart",
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": granted})
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
