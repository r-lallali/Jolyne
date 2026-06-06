package quota_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ralys/jolyne/backend/internal/quota"
)

type quotaResp struct {
	Plan string `json:"plan"`
	Bot  struct {
		Used      int64 `json:"used"`
		Limit     int64 `json:"limit"`
		Remaining int64 `json:"remaining"`
	} `json:"bot"`
	Swipe struct {
		Used      int64 `json:"used"`
		Limit     int64 `json:"limit"`
		Remaining int64 `json:"remaining"`
	} `json:"swipe"`
}

func doGet(t *testing.T, h *quota.Handler, fp string) quotaResp {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/api/quota", nil)
	if fp != "" {
		r.Header.Set("X-Device-FP", fp)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status: attendu 200, got %d", w.Code)
	}
	var resp quotaResp
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return resp
}

// Premium : pas de plafond. limit=0 / remaining=-1 (illimité), aucun accès
// au moteur Redis (Engine nil ne doit pas être touché).
func TestHandler_Premium(t *testing.T) {
	h := &quota.Handler{
		ResolveUserID: func(*http.Request) int64 { return 42 },
		IsPremium:     func(context.Context, int64) bool { return true },
	}
	resp := doGet(t, h, "fp-x")
	if resp.Plan != "premium" {
		t.Fatalf("plan: attendu premium, got %q", resp.Plan)
	}
	if resp.Bot.Limit != 0 || resp.Bot.Remaining != -1 {
		t.Fatalf("bot premium: attendu limit=0 remaining=-1, got %+v", resp.Bot)
	}
}

// Free, sans moteur branché (Engine nil) : fail-open — used=0, restant plein.
// Vérifie aussi que le plafond prof IA exposé est bien FreeBotDaily.
func TestHandler_FreeFailOpen(t *testing.T) {
	h := &quota.Handler{} // Engine nil, pas d'auth → anonyme Free
	resp := doGet(t, h, "fp-anon")
	if resp.Plan != "free" {
		t.Fatalf("plan: attendu free, got %q", resp.Plan)
	}
	if resp.Bot.Limit != quota.FreeBotDaily {
		t.Fatalf("bot limit: attendu %d, got %d", quota.FreeBotDaily, resp.Bot.Limit)
	}
	if resp.Bot.Used != 0 || resp.Bot.Remaining != quota.FreeBotDaily {
		t.Fatalf("bot fail-open: attendu used=0 remaining=%d, got %+v", quota.FreeBotDaily, resp.Bot)
	}
}

func TestHandler_MethodNotAllowed(t *testing.T) {
	h := &quota.Handler{}
	r := httptest.NewRequest(http.MethodPost, "/api/quota", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status: attendu 405, got %d", w.Code)
	}
}
