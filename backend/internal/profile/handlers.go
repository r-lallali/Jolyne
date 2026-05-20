package profile

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ralys/jolyne/backend/internal/users"
)

type Handlers struct {
	Store      *Store
	Cloudinary CloudinaryConfig
	Log        *slog.Logger
}

func (h *Handlers) log() *slog.Logger {
	if h.Log != nil {
		return h.Log
	}
	return slog.Default()
}

type promptDTO struct {
	Prompt string `json:"prompt"`
	Answer string `json:"answer"`
}

type profileDTO struct {
	DisplayName string       `json:"display_name"`
	Bio         string       `json:"bio"`
	Birthdate   *string      `json:"birthdate,omitempty"` // ISO yyyy-mm-dd
	Prompts     [3]promptDTO `json:"prompts"`
}

type photoDTO struct {
	Position int    `json:"position"`
	PublicID string `json:"public_id"`
}

type accountDTO struct {
	Profile profileDTO `json:"profile"`
	Photos  []photoDTO `json:"photos"`
}

// HandleGet : GET /api/account → profile + photos du user courant.
func (h *Handlers) HandleGet(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	p, err := h.Store.Get(ctx, user.ID)
	if err != nil {
		h.log().Error("account get profile", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	photos, err := h.Store.ListPhotos(ctx, user.ID)
	if err != nil {
		h.log().Error("account list photos", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	writeAccount(w, p, photos)
}

// HandlePut : PUT /api/account → met à jour le profil.
func (h *Handlers) HandlePut(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	var body profileDTO
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024)).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	var bd *time.Time
	if body.Birthdate != nil && *body.Birthdate != "" {
		t, err := time.Parse("2006-01-02", *body.Birthdate)
		if err != nil {
			http.Error(w, "invalid birthdate", http.StatusBadRequest)
			return
		}
		bd = &t
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	p, err := h.Store.Upsert(ctx, Profile{
		UserID:      user.ID,
		DisplayName: body.DisplayName,
		Bio:         body.Bio,
		Birthdate:   bd,
		Prompt1:     body.Prompts[0].Prompt,
		Answer1:     body.Prompts[0].Answer,
		Prompt2:     body.Prompts[1].Prompt,
		Answer2:     body.Prompts[1].Answer,
		Prompt3:     body.Prompts[2].Prompt,
		Answer3:     body.Prompts[2].Answer,
	})
	if err != nil {
		h.log().Error("account upsert", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	photos, err := h.Store.ListPhotos(ctx, user.ID)
	if err != nil {
		h.log().Error("account list photos", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	writeAccount(w, p, photos)
}

// HandleSignPhotoUpload : POST /api/account/photos/sign → signature
// pour upload direct Cloudinary depuis le front. 503 si Cloudinary
// pas configuré.
func (h *Handlers) HandleSignPhotoUpload(w http.ResponseWriter, r *http.Request) {
	if _, ok := users.CurrentUser(r.Context()); !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	if !h.Cloudinary.IsConfigured() {
		http.Error(w, "photo upload unavailable", http.StatusServiceUnavailable)
		return
	}
	params := h.Cloudinary.Sign()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(params)
}

// HandleSetPhoto : POST /api/account/photos {position, public_id} →
// enregistre la photo après upload Cloudinary réussi.
func (h *Handlers) HandleSetPhoto(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	var body photoDTO
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024)).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if body.Position < 1 || body.Position > MaxPhotos {
		http.Error(w, "invalid position", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(body.PublicID) == "" {
		http.Error(w, "public_id required", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	p, err := h.Store.SetPhoto(ctx, user.ID, body.Position, body.PublicID)
	if err != nil {
		h.log().Error("account set photo", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(photoToDTO(p))
}

// HandleDeletePhoto : DELETE /api/account/photos/{position}.
func (h *Handlers) HandleDeletePhoto(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	posStr := strings.TrimPrefix(r.URL.Path, "/api/account/photos/")
	pos, err := strconv.Atoi(posStr)
	if err != nil || pos < 1 || pos > MaxPhotos {
		http.Error(w, "invalid position", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := h.Store.DeletePhoto(ctx, user.ID, pos); err != nil {
		h.log().Error("account delete photo", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeAccount(w http.ResponseWriter, p Profile, photos []Photo) {
	w.Header().Set("Content-Type", "application/json")
	out := accountDTO{
		Profile: profileToDTO(p),
		Photos:  make([]photoDTO, 0, len(photos)),
	}
	for _, ph := range photos {
		out.Photos = append(out.Photos, photoToDTO(ph))
	}
	_ = json.NewEncoder(w).Encode(out)
}

func profileToDTO(p Profile) profileDTO {
	out := profileDTO{
		DisplayName: p.DisplayName,
		Bio:         p.Bio,
		Prompts: [3]promptDTO{
			{Prompt: p.Prompt1, Answer: p.Answer1},
			{Prompt: p.Prompt2, Answer: p.Answer2},
			{Prompt: p.Prompt3, Answer: p.Answer3},
		},
	}
	if p.Birthdate != nil {
		s := p.Birthdate.Format("2006-01-02")
		out.Birthdate = &s
	}
	return out
}

func photoToDTO(p Photo) photoDTO {
	return photoDTO{Position: p.Position, PublicID: p.PublicID}
}

// HandleCloudConfig : GET /api/account/cloudinary-config (public, sans
// auth) — renvoie le cloud_name pour que le front construise les URLs
// de display (https://res.cloudinary.com/{cloud_name}/image/upload/...).
// Pas confidentiel.
func (h *Handlers) HandleCloudConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"cloud_name": h.Cloudinary.CloudName,
	})
}
