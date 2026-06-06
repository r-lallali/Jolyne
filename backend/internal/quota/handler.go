package quota

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
)

// Handler expose GET /api/quota : l'état des compteurs du jour pour l'identité
// courante (userID via cookie si connecté, sinon fingerprint via l'en-tête
// X-Device-FP ou ?fp=). Sert au front à afficher le nombre de messages prof IA
// restants et à griser l'option quand la limite est atteinte.
//
// Lecture seule (aucun incrément) — un simple GET du compteur Redis.
type Handler struct {
	Engine *Engine
	// ResolveUserID résout le cookie de session → userID (0 si anonyme).
	// IsPremium dit si ce user a un abonnement actif. Optionnels : nil →
	// comportement anonyme / non-premium (décompte par fingerprint).
	ResolveUserID func(r *http.Request) int64
	IsPremium     func(ctx context.Context, userID int64) bool
}

type usageDTO struct {
	Used      int64 `json:"used"`
	Limit     int64 `json:"limit"`     // plafond Free du jour ; 0 = illimité (Premium)
	Remaining int64 `json:"remaining"` // restant ; -1 = illimité (Premium)
}

type stateDTO struct {
	Plan      string   `json:"plan"` // "free" | "premium"
	Bot       usageDTO `json:"bot"`
	Swipe     usageDTO `json:"swipe"`
	Translate usageDTO `json:"translate"`
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID := int64(0)
	if h.ResolveUserID != nil {
		userID = h.ResolveUserID(r)
	}
	premium := userID > 0 && h.IsPremium != nil && h.IsPremium(r.Context(), userID)

	fp := strings.TrimSpace(r.Header.Get("X-Device-FP"))
	if fp == "" {
		fp = strings.TrimSpace(r.URL.Query().Get("fp"))
	}
	id := Identity(userID, fp)

	resp := stateDTO{Plan: "free"}
	if premium {
		resp.Plan = "premium"
		unlimited := usageDTO{Limit: 0, Remaining: -1}
		resp.Bot = unlimited
		resp.Swipe = unlimited
		resp.Translate = unlimited
	} else {
		resp.Bot = h.usageFor(r.Context(), KindBot, id, FreeBotDaily)
		resp.Swipe = h.usageFor(r.Context(), KindNext, id, FreeNextDaily)
		resp.Translate = h.usageFor(r.Context(), KindTranslate, id, FreeTranslateDaily)
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(resp)
}

// usageFor lit le compteur (kind, id) et calcule le restant. Fail-open : sur
// erreur Redis ou identité absente, on renvoie used=0 (restant = plafond)
// plutôt que de bloquer le front sur un compteur faussement épuisé.
func (h *Handler) usageFor(ctx context.Context, kind Kind, id string, limit int64) usageDTO {
	used := int64(0)
	if h.Engine != nil && id != "" {
		if v, err := h.Engine.Used(ctx, kind, id); err == nil {
			used = v
		}
	}
	remaining := limit - used
	if remaining < 0 {
		remaining = 0
	}
	return usageDTO{Used: used, Limit: limit, Remaining: remaining}
}
