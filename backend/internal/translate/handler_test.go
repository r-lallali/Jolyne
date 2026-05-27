package translate_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ralys/jolyne/backend/internal/translate"
)

func newUpstream(t *testing.T, body string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(body))
	}))
}

func newHandler(upstreamURL string) *translate.Handler {
	return &translate.Handler{Client: translate.NewClient(upstreamURL, "")}
}

func TestHandler_RejectsGET(t *testing.T) {
	h := newHandler("http://invalid")
	req := httptest.NewRequest(http.MethodGet, "/api/translate", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status: %d", rec.Code)
	}
}

func TestHandler_RejectsInvalidJSON(t *testing.T) {
	h := newHandler("http://invalid")
	req := httptest.NewRequest(http.MethodPost, "/api/translate", strings.NewReader("not-json"))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: %d", rec.Code)
	}
}

func TestHandler_RejectsEmptyText(t *testing.T) {
	h := newHandler("http://invalid")
	req := httptest.NewRequest(http.MethodPost, "/api/translate", strings.NewReader(`{"text":"  ","source":"en","target":"fr"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: %d", rec.Code)
	}
}

func TestHandler_RejectsTooLong(t *testing.T) {
	h := newHandler("http://invalid")
	long := strings.Repeat("é", 501) // 501 runes
	req := httptest.NewRequest(http.MethodPost, "/api/translate",
		strings.NewReader(`{"text":"`+long+`","source":"en","target":"fr"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: %d", rec.Code)
	}
}

func TestHandler_RejectsUnknownLangs(t *testing.T) {
	h := newHandler("http://invalid")
	cases := []struct {
		body string
		name string
	}{
		{`{"text":"hi","source":"kr","target":"fr"}`, "unknown-source"},
		{`{"text":"hi","source":"en","target":"kr"}`, "unknown-target"},
		{`{"text":"hi","source":"en","target":"auto"}`, "target-auto"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/translate", strings.NewReader(tc.body))
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status: %d", rec.Code)
			}
		})
	}
}

func TestHandler_AcceptsAutoSource(t *testing.T) {
	srv := newUpstream(t, `{"translatedText":"bonjour"}`)
	defer srv.Close()
	h := newHandler(srv.URL)
	req := httptest.NewRequest(http.MethodPost, "/api/translate",
		strings.NewReader(`{"text":"hello","source":"auto","target":"fr"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: %d, body: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "bonjour") {
		t.Fatalf("body: %s", rec.Body.String())
	}
}

func TestHandler_UpstreamFailure_Returns502(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	h := newHandler(srv.URL)
	req := httptest.NewRequest(http.MethodPost, "/api/translate",
		strings.NewReader(`{"text":"hi","source":"en","target":"fr"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status: %d", rec.Code)
	}
}

func TestHandler_NormalizesLangCase(t *testing.T) {
	srv := newUpstream(t, `{"translatedText":"x"}`)
	defer srv.Close()
	h := newHandler(srv.URL)
	req := httptest.NewRequest(http.MethodPost, "/api/translate",
		strings.NewReader(`{"text":"hi","source":"EN","target":"FR"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: %d", rec.Code)
	}
}
