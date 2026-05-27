package grammar_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ralys/jolyne/backend/internal/grammar"
)

func TestClient_Check_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/check" {
			t.Fatalf("path: %q", r.URL.Path)
		}
		if r.Method != http.MethodPost {
			t.Fatalf("method: %s", r.Method)
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/x-www-form-urlencoded" {
			t.Fatalf("content-type: %q", ct)
		}
		raw, _ := io.ReadAll(r.Body)
		body := string(raw)
		if !strings.Contains(body, "text=hello+wrold") {
			t.Fatalf("body: %s", body)
		}
		if !strings.Contains(body, "language=en-US") {
			t.Fatalf("body lang: %s", body)
		}
		_, _ = w.Write([]byte(`{"matches":[{
			"message":"Possible spelling mistake",
			"shortMessage":"Spelling",
			"offset":6,"length":5,
			"replacements":[{"value":"world"},{"value":"would"}]
		}]}`))
	}))
	defer srv.Close()

	c := grammar.NewClient(srv.URL)
	matches, err := c.Check(context.Background(), "hello wrold", "en-US")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if len(matches) != 1 {
		t.Fatalf("matches: %+v", matches)
	}
	m := matches[0]
	if m.Offset != 6 || m.Length != 5 {
		t.Fatalf("offsets: %+v", m)
	}
	if len(m.Replacements) != 2 || m.Replacements[0] != "world" {
		t.Fatalf("replacements: %+v", m.Replacements)
	}
}

func TestClient_Check_TruncatesReplacements(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"matches":[{
			"message":"x","offset":0,"length":1,
			"replacements":[
				{"value":"a"},{"value":"b"},{"value":"c"},
				{"value":"d"},{"value":"e"},{"value":"f"},{"value":"g"}
			]
		}]}`))
	}))
	defer srv.Close()
	c := grammar.NewClient(srv.URL)
	matches, err := c.Check(context.Background(), "x", "en-US")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if len(matches[0].Replacements) != 5 {
		t.Fatalf("replacements doivent être tronqués à 5, got %d", len(matches[0].Replacements))
	}
}

func TestClient_Check_DisablesChatUnfriendlyRules(t *testing.T) {
	var disabled string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		disabled = r.Form.Get("disabledRules")
		_, _ = w.Write([]byte(`{"matches":[]}`))
	}))
	defer srv.Close()
	c := grammar.NewClient(srv.URL)
	if _, err := c.Check(context.Background(), "salut", "fr"); err != nil {
		t.Fatalf("check: %v", err)
	}
	for _, want := range []string{"UPPERCASE_SENTENCE_START", "PUNCTUATION_PARAGRAPH_END"} {
		if !strings.Contains(disabled, want) {
			t.Fatalf("disabledRules manque %q: %q", want, disabled)
		}
	}
}

func TestClient_Check_HandlesUpstreamError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`down`))
	}))
	defer srv.Close()
	c := grammar.NewClient(srv.URL)
	if _, err := c.Check(context.Background(), "x", "en-US"); err == nil {
		t.Fatal("erreur upstream doit être propagée")
	}
}

func TestClient_Check_EmptyMatches(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"matches":[]}`))
	}))
	defer srv.Close()
	c := grammar.NewClient(srv.URL)
	matches, err := c.Check(context.Background(), "perfect", "en-US")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if matches == nil {
		t.Fatal("matches doit être un slice vide, pas nil")
	}
	if len(matches) != 0 {
		t.Fatalf("len: %d", len(matches))
	}
}
