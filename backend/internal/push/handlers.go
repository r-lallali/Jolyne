package push

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/ralys/jolyne/backend/internal/users"
)

type Handlers struct {
	Store    *Store
	VAPIDPub string
	Log      *slog.Logger
}

func (h *Handlers) log() *slog.Logger {
	if h.Log != nil {
		return h.Log
	}
	return slog.Default()
}

// HandleVAPIDPublicKey : GET /api/notifications/vapid-public-key. Le front
// en a besoin pour PushManager.subscribe(). La clé est publique par
// design — pas de secret ici.
func (h *Handlers) HandleVAPIDPublicKey(w http.ResponseWriter, _ *http.Request) {
	if h.VAPIDPub == "" {
		http.Error(w, "push disabled", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"public_key": h.VAPIDPub})
}

type subscribeBody struct {
	Endpoint  string `json:"endpoint"`
	P256dh    string `json:"p256dh"`
	Auth      string `json:"auth"`
	UserAgent string `json:"user_agent"`
}

// HandleSubscribe : POST /api/notifications/subscribe. Auth requise. Le
// body est ce que PushManager.subscribe() retourne, à plat (le front
// extrait endpoint + keys.p256dh + keys.auth).
func (h *Handlers) HandleSubscribe(w http.ResponseWriter, r *http.Request) {
	user, ok := users.CurrentUser(r.Context())
	if !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	var body subscribeBody
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024)).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if body.Endpoint == "" || body.P256dh == "" || body.Auth == "" {
		http.Error(w, "missing fields", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := h.Store.Upsert(ctx, user.ID, Subscription(body)); err != nil {
		h.log().Error("push subscribe", "err", err)
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleUnsubscribe : DELETE /api/notifications/subscribe?endpoint=... ou
// body JSON {endpoint}. Auth requise — on ne vérifie pas l'ownership car
// la valeur d'endpoint suffit comme secret (impossible à deviner).
func (h *Handlers) HandleUnsubscribe(w http.ResponseWriter, r *http.Request) {
	if _, ok := users.CurrentUser(r.Context()); !ok {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	endpoint := r.URL.Query().Get("endpoint")
	if endpoint == "" {
		var body struct {
			Endpoint string `json:"endpoint"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2*1024)).Decode(&body); err == nil {
			endpoint = body.Endpoint
		}
	}
	if endpoint == "" {
		http.Error(w, "missing endpoint", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := h.Store.DeleteByEndpoint(ctx, endpoint); err != nil {
		// 404 silencieux (déjà désabonné) — on retourne quand même 204
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
