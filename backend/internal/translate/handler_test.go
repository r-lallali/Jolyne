package translate_test

import (
	"context"
	"encoding/json"
	"io"
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

func TestHandler_AutoSource_ExposesDetected(t *testing.T) {
	srv := newUpstream(t, `{"translatedText":"bonjour","detectedLanguage":{"confidence":90.0,"language":"zh"}}`)
	defer srv.Close()
	h := newHandler(srv.URL)
	req := httptest.NewRequest(http.MethodPost, "/api/translate",
		strings.NewReader(`{"text":"你好","source":"auto","target":"fr"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: %d, body: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"detected":"zh"`) {
		t.Fatalf("detected absent du body: %s", rec.Body.String())
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

// TestHandler_RetryAutoOnIdenticalOutput : garde-fou « sortie = entrée ».
// Un texte chinois annoncé "en" ressort inchangé de LibreTranslate → le
// handler re-tente en "auto" et sert le résultat de la 2e passe.
func TestHandler_RetryAutoOnIdenticalOutput(t *testing.T) {
	var calls int
	var sources []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		raw, _ := io.ReadAll(r.Body)
		var got map[string]string
		_ = json.Unmarshal(raw, &got)
		sources = append(sources, got["source"])
		if got["source"] == "auto" {
			_, _ = w.Write([]byte(`{"translatedText":"bonjour","detectedLanguage":{"confidence":95.0,"language":"zh"}}`))
			return
		}
		// Source explicite erronée : LibreTranslate renvoie l'entrée telle quelle.
		_, _ = w.Write([]byte(`{"translatedText":"` + got["q"] + `"}`))
	}))
	defer srv.Close()
	h := newHandler(srv.URL)
	req := httptest.NewRequest(http.MethodPost, "/api/translate",
		strings.NewReader(`{"text":"你好","source":"en","target":"fr"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: %d, body: %s", rec.Code, rec.Body.String())
	}
	if calls != 2 || len(sources) != 2 || sources[1] != "auto" {
		t.Fatalf("attendu 2 appels (en puis auto), eu %d (%v)", calls, sources)
	}
	if !strings.Contains(rec.Body.String(), "bonjour") ||
		!strings.Contains(rec.Body.String(), `"detected":"zh"`) {
		t.Fatalf("body: %s", rec.Body.String())
	}
}

// TestHandler_KeepsIdenticalWhenAutoAgreesToo : si la re-tentative auto
// renvoie aussi l'entrée (mot identique dans les deux langues), on garde le
// résultat original sans erreur.
func TestHandler_KeepsIdenticalWhenAutoAgreesToo(t *testing.T) {
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		_, _ = w.Write([]byte(`{"translatedText":"taxi"}`))
	}))
	defer srv.Close()
	h := newHandler(srv.URL)
	req := httptest.NewRequest(http.MethodPost, "/api/translate",
		strings.NewReader(`{"text":"taxi","source":"fr","target":"en"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: %d", rec.Code)
	}
	if calls != 2 {
		t.Fatalf("attendu 2 appels (fr puis auto), eu %d", calls)
	}
	if !strings.Contains(rec.Body.String(), "taxi") {
		t.Fatalf("body: %s", rec.Body.String())
	}
}

// TestHandler_PhraseRoutesToAI : une phrase (multi-mots) part sur le
// traducteur IA — LibreTranslate n'est pas appelé.
func TestHandler_PhraseRoutesToAI(t *testing.T) {
	var ltCalls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ltCalls++
		_, _ = w.Write([]byte(`{"translatedText":"lt"}`))
	}))
	defer srv.Close()
	h := newHandler(srv.URL)
	h.AI = &translate.AITranslator{Reply: func(ctx context.Context, system, userMsg string) (string, error) {
		return `{"translation":"Bonjour tout le monde","detected":"en","romanization":""}`, nil
	}}
	req := httptest.NewRequest(http.MethodPost, "/api/translate",
		strings.NewReader(`{"text":"hello everyone","source":"en","target":"fr"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: %d, body: %s", rec.Code, rec.Body.String())
	}
	if ltCalls != 0 {
		t.Fatalf("LibreTranslate ne devrait pas être appelé pour une phrase (%d appels)", ltCalls)
	}
	if !strings.Contains(rec.Body.String(), "Bonjour tout le monde") {
		t.Fatalf("body: %s", rec.Body.String())
	}
}

// TestHandler_SingleWordStaysOnLT : un mot isolé reste sur LibreTranslate
// même si l'IA est configurée.
func TestHandler_SingleWordStaysOnLT(t *testing.T) {
	srv := newUpstream(t, `{"translatedText":"bonjour"}`)
	defer srv.Close()
	h := newHandler(srv.URL)
	aiCalled := false
	h.AI = &translate.AITranslator{Reply: func(ctx context.Context, system, userMsg string) (string, error) {
		aiCalled = true
		return `{"translation":"x"}`, nil
	}}
	req := httptest.NewRequest(http.MethodPost, "/api/translate",
		strings.NewReader(`{"text":"hello","source":"en","target":"fr"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: %d", rec.Code)
	}
	if aiCalled {
		t.Fatal("l'IA ne devrait pas être appelée pour un mot isolé")
	}
	if !strings.Contains(rec.Body.String(), "bonjour") {
		t.Fatalf("body: %s", rec.Body.String())
	}
}

// TestHandler_AIFailureFallsBackToLT : erreur IA → repli LibreTranslate.
func TestHandler_AIFailureFallsBackToLT(t *testing.T) {
	srv := newUpstream(t, `{"translatedText":"bonjour à tous"}`)
	defer srv.Close()
	h := newHandler(srv.URL)
	h.AI = &translate.AITranslator{Reply: func(ctx context.Context, system, userMsg string) (string, error) {
		return "", context.DeadlineExceeded
	}}
	req := httptest.NewRequest(http.MethodPost, "/api/translate",
		strings.NewReader(`{"text":"hello everyone","source":"en","target":"fr"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: %d, body: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "bonjour à tous") {
		t.Fatalf("body: %s", rec.Body.String())
	}
}

// TestHandler_RomanizationExposed : la romanisation du chemin IA est
// relayée dans la réponse JSON.
func TestHandler_RomanizationExposed(t *testing.T) {
	srv := newUpstream(t, `{"translatedText":"nope"}`)
	defer srv.Close()
	h := newHandler(srv.URL)
	h.AI = &translate.AITranslator{Reply: func(ctx context.Context, system, userMsg string) (string, error) {
		return `{"translation":"Bonjour, comment ça va ?","detected":"zh","romanization":"nǐ hǎo ma"}`, nil
	}}
	req := httptest.NewRequest(http.MethodPost, "/api/translate",
		strings.NewReader(`{"text":"你好吗 朋友","source":"zh","target":"fr"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"romanization":"nǐ hǎo ma"`) {
		t.Fatalf("romanization absente: %s", rec.Body.String())
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
