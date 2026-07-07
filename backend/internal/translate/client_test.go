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

func TestClient_Translate_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/translate" {
			t.Fatalf("path: %q", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("method: %s", r.Method)
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/json" {
			t.Fatalf("content-type: %q", ct)
		}
		raw, _ := io.ReadAll(r.Body)
		var got map[string]string
		if err := json.Unmarshal(raw, &got); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if got["q"] != "hello" || got["source"] != "en" || got["target"] != "fr" {
			t.Fatalf("payload: %+v", got)
		}
		_, _ = w.Write([]byte(`{"translatedText":"bonjour"}`))
	}))
	defer srv.Close()

	c := translate.NewClient(srv.URL, "")
	out, err := c.Translate(context.Background(), "hello", "en", "fr")
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	if out.Translated != "bonjour" {
		t.Fatalf("translated: %q", out.Translated)
	}
	if out.Detected != "" {
		t.Fatalf("detected devrait être vide sans auto: %q", out.Detected)
	}
}

func TestClient_Translate_AutoReturnsDetected(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"translatedText":"bonjour","detectedLanguage":{"confidence":92.0,"language":"EN"}}`))
	}))
	defer srv.Close()
	c := translate.NewClient(srv.URL, "")
	out, err := c.Translate(context.Background(), "hello", "auto", "fr")
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	if out.Translated != "bonjour" {
		t.Fatalf("translated: %q", out.Translated)
	}
	if out.Detected != "en" {
		t.Fatalf("detected devrait être normalisé en minuscules: %q", out.Detected)
	}
}

func TestClient_Translate_PassesAPIKey(t *testing.T) {
	var seen string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var got map[string]string
		_ = json.Unmarshal(raw, &got)
		seen = got["api_key"]
		_, _ = w.Write([]byte(`{"translatedText":"x"}`))
	}))
	defer srv.Close()
	c := translate.NewClient(srv.URL, "secret-key")
	if _, err := c.Translate(context.Background(), "a", "en", "fr"); err != nil {
		t.Fatalf("translate: %v", err)
	}
	if seen != "secret-key" {
		t.Fatalf("api_key non transmise: %q", seen)
	}
}

func TestClient_Translate_HandlesUpstreamError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`upstream down`))
	}))
	defer srv.Close()
	c := translate.NewClient(srv.URL, "")
	_, err := c.Translate(context.Background(), "x", "en", "fr")
	if err == nil {
		t.Fatal("erreur 503 doit être propagée")
	}
	if !strings.Contains(err.Error(), "503") {
		t.Fatalf("err devrait contenir le code: %v", err)
	}
}

func TestClient_Translate_HandlesAPIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"error":"language not supported"}`))
	}))
	defer srv.Close()
	c := translate.NewClient(srv.URL, "")
	_, err := c.Translate(context.Background(), "x", "kr", "fr")
	if err == nil {
		t.Fatal("erreur applicative doit être propagée")
	}
	if !strings.Contains(err.Error(), "language not supported") {
		t.Fatalf("err devrait contenir le message: %v", err)
	}
}

func TestClient_Translate_ContextCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // déjà annulé avant l'appel.
	c := translate.NewClient("http://127.0.0.1:1", "")
	if _, err := c.Translate(ctx, "x", "en", "fr"); err == nil {
		t.Fatal("context déjà annulé doit faire échouer l'appel")
	}
}
