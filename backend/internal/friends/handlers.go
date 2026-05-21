package friends

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ralys/jolyne/backend/internal/profile"
	"github.com/ralys/jolyne/backend/internal/users"
)

// Handlers : endpoints HTTP `/api/friends/*`. Gated par users.RequireAuth
// au niveau du routeur — chaque handler récupère le user via
// users.CurrentUser(ctx).
type Handlers struct {
	Store   *Store
	Profile *profile.Store // pour exposer le profil d'un ami
	Log     *slog.Logger
}

func (h *Handlers) log() *slog.Logger {
	if h.Log != nil {
		return h.Log
	}
	return slog.Default()
}

type friendDTO struct {
	ID            int64  `json:"id"`
	PeerID        int64  `json:"peer_id"`
	PeerName      string `json:"peer_name"`
	PeerPhotoID   string `json:"peer_photo_id,omitempty"`
	PeerRemovedMe bool   `json:"peer_removed_me"`
	UnreadCount   int    `json:"unread_count"`
	CreatedAt     string `json:"created_at"`
	LastMessageAt string `json:"last_message_at"`
}

type messageDTO struct {
	ID       int64  `json:"id"`
	SenderID int64  `json:"sender_id"`
	Body     string `json:"body"`
	SentAt   string `json:"sent_at"`
}

// HandleList : GET /api/friends → mes amis (visible = non-soft-deleted
// par moi), avec display_name + photo principale.
func (h *Handlers) HandleList(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	list, err := h.Store.ListFor(ctx, user.ID)
	if err != nil {
		h.log().Error("friends list", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	out := make([]friendDTO, 0, len(list))
	for _, f := range list {
		out = append(out, friendDTO{
			ID:            f.ID,
			PeerID:        f.PeerID,
			PeerName:      h.peerDisplayName(ctx, f.PeerID),
			PeerPhotoID:   h.peerPhoto(ctx, f.PeerID),
			PeerRemovedMe: f.PeerRemovedMe,
			UnreadCount:   f.UnreadCount,
			CreatedAt:     f.CreatedAt.UTC().Format(time.RFC3339),
			LastMessageAt: f.LastMessageAt.UTC().Format(time.RFC3339),
		})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"friends": out})
}

// HandleRemove : DELETE /api/friends/{id} — soft-delete unilatéral discret.
func (h *Handlers) HandleRemove(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	id, err := parseIDSuffix(r.URL.Path, "/api/friends/")
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := h.Store.Remove(ctx, id, user.ID); err != nil {
		if errors.Is(err, ErrNotFound) {
			http.NotFound(w, r)
			return
		}
		h.log().Error("friends remove", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleGetMessages : GET /api/friends/{id}/messages → 200 derniers.
func (h *Handlers) HandleGetMessages(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	id, err := parseIDFromPath(r.URL.Path)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	f, err := h.Store.Get(ctx, id, user.ID)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	msgs, err := h.Store.ListMessages(ctx, id, 0)
	if err != nil {
		h.log().Error("friends list msgs", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	out := make([]messageDTO, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, messageDTO{
			ID: m.ID, SenderID: m.SenderID, Body: m.Body,
			SentAt: m.SentAt.UTC().Format(time.RFC3339),
		})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"messages":        out,
		"peer_removed_me": f.PeerRemovedMe,
	})
}

// HandlePostMessage : POST /api/friends/{id}/messages {body} → message créé.
func (h *Handlers) HandlePostMessage(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	id, err := parseIDFromPath(r.URL.Path)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	var body struct {
		Body string `json:"body"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024)).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if _, err := h.Store.Get(ctx, id, user.ID); err != nil {
		http.NotFound(w, r)
		return
	}
	m, err := h.Store.AppendMessage(ctx, id, user.ID, body.Body)
	if err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(messageDTO{
		ID: m.ID, SenderID: m.SenderID, Body: m.Body,
		SentAt: m.SentAt.UTC().Format(time.RFC3339),
	})
}

// HandleGetProfile : GET /api/friends/{id}/profile → profil du peer.
// Visibilité gated : on n'accède au profil que si on est ami.
func (h *Handlers) HandleGetProfile(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	id, err := parseIDFromPath(r.URL.Path)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	f, err := h.Store.Get(ctx, id, user.ID)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	p, err := h.Profile.Get(ctx, f.PeerID)
	if err != nil {
		h.log().Error("friends get profile", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	photos, err := h.Profile.ListPhotos(ctx, f.PeerID)
	if err != nil {
		h.log().Error("friends get photos", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	type photoOut struct {
		Position int    `json:"position"`
		PublicID string `json:"public_id"`
	}
	outPhotos := make([]photoOut, 0, len(photos))
	for _, ph := range photos {
		outPhotos = append(outPhotos, photoOut{Position: ph.Position, PublicID: ph.PublicID})
	}
	w.Header().Set("Content-Type", "application/json")
	type promptOut struct {
		Prompt string `json:"prompt"`
		Answer string `json:"answer"`
	}
	prompts := [3]promptOut{
		{Prompt: p.Prompt1, Answer: p.Answer1},
		{Prompt: p.Prompt2, Answer: p.Answer2},
		{Prompt: p.Prompt3, Answer: p.Answer3},
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"peer_id":         f.PeerID,
		"display_name":    p.DisplayName,
		"bio":             p.Bio,
		"birthdate":       formatDate(p.Birthdate),
		"photos":          outPhotos,
		"prompts":         prompts,
		"peer_removed_me": f.PeerRemovedMe,
	})
}

func (h *Handlers) peerDisplayName(ctx context.Context, userID int64) string {
	if h.Profile == nil {
		return ""
	}
	p, err := h.Profile.Get(ctx, userID)
	if err != nil {
		return ""
	}
	return p.DisplayName
}

func (h *Handlers) peerPhoto(ctx context.Context, userID int64) string {
	if h.Profile == nil {
		return ""
	}
	photos, err := h.Profile.ListPhotos(ctx, userID)
	if err != nil || len(photos) == 0 {
		return ""
	}
	for _, p := range photos {
		if p.Position == 1 {
			return p.PublicID
		}
	}
	return photos[0].PublicID
}

func formatDate(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format("2006-01-02")
	return &s
}

// parseIDFromPath : extrait l'id depuis `/api/friends/{id}/...`.
func parseIDFromPath(path string) (int64, error) {
	rest := strings.TrimPrefix(path, "/api/friends/")
	if i := strings.Index(rest, "/"); i >= 0 {
		rest = rest[:i]
	}
	return strconv.ParseInt(rest, 10, 64)
}

func parseIDSuffix(path, prefix string) (int64, error) {
	return strconv.ParseInt(strings.TrimPrefix(path, prefix), 10, 64)
}
