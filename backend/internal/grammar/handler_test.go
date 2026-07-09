package grammar_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ralys/jolyne/backend/internal/grammar"
)

func newHandler(upstreamURL string) *grammar.Handler {
	return &grammar.Handler{Client: grammar.NewClient(upstreamURL)}
}

func TestGrammarHandler_RejectsGET(t *testing.T) {
	h := newHandler("http://invalid")
	req := httptest.NewRequest(http.MethodGet, "/api/grammar", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status: %d", rec.Code)
	}
}

func TestGrammarHandler_RejectsEmptyText(t *testing.T) {
	h := newHandler("http://invalid")
	req := httptest.NewRequest(http.MethodPost, "/api/grammar", strings.NewReader(`{"text":"   ","lang":"fr"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: %d", rec.Code)
	}
}

func TestGrammarHandler_RejectsTooLong(t *testing.T) {
	h := newHandler("http://invalid")
	body := `{"text":"` + strings.Repeat("a", 2001) + `","lang":"en"}`
	req := httptest.NewRequest(http.MethodPost, "/api/grammar", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: %d", rec.Code)
	}
}

func TestGrammarHandler_RejectsUnknownLang(t *testing.T) {
	h := newHandler("http://invalid")
	req := httptest.NewRequest(http.MethodPost, "/api/grammar", strings.NewReader(`{"text":"x","lang":"kr"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: %d", rec.Code)
	}
}

func TestGrammarHandler_AcceptsLangAliases(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"matches":[]}`))
	}))
	defer srv.Close()
	h := newHandler(srv.URL)
	for _, lang := range []string{"fr", "FR", "en", "EN-US", "de", "es", "es-ES", "it-IT"} {
		t.Run(lang, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/grammar",
				strings.NewReader(`{"text":"hi","lang":"`+lang+`"}`))
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("status %d for lang %q: %s", rec.Code, lang, rec.Body.String())
			}
		})
	}
}

func TestGrammarHandler_RejectsInvalidJSON(t *testing.T) {
	h := newHandler("http://invalid")
	req := httptest.NewRequest(http.MethodPost, "/api/grammar", strings.NewReader("{not-json"))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: %d", rec.Code)
	}
}

func TestGrammarHandler_UpstreamFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	h := newHandler(srv.URL)
	req := httptest.NewRequest(http.MethodPost, "/api/grammar", strings.NewReader(`{"text":"hi","lang":"fr"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status: %d", rec.Code)
	}
}
