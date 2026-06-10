package claudeapi

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

// scriptedRT rejoue une séquence de status codes, puis 200. Permet de tester
// les budgets de retry sans réseau ni vrai backoff côté serveur.
type scriptedRT struct {
	statuses []int // codes à renvoyer dans l'ordre ; épuisé → 200
	calls    int
}

func (rt *scriptedRT) RoundTrip(_ *http.Request) (*http.Response, error) {
	status := http.StatusOK
	if rt.calls < len(rt.statuses) {
		status = rt.statuses[rt.calls]
	}
	rt.calls++
	body := `{"content":[{"type":"text","text":"ok"}],"stop_reason":"end_turn"}`
	if status != http.StatusOK {
		body = `{"type":"error","error":{"type":"rate_limit_error","message":"x"}}`
	}
	return &http.Response{
		StatusCode: status,
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     make(http.Header),
	}, nil
}

// 429 ×2 puis 200 : le budget 429 (maxRetries429=2) doit absorber le pic —
// c'est le scénario "plusieurs profs IA répondent en même temps".
func TestReply_RetriesTwiceOn429(t *testing.T) {
	rt := &scriptedRT{statuses: []int{429, 429}}
	c := New("test-key", WithHTTPClient(&http.Client{Transport: rt}))

	got, err := c.Reply(context.Background(), "sys", nil, "salut")
	if err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if got != "ok" {
		t.Fatalf("réponse = %q, attendu ok", got)
	}
	if rt.calls != 3 {
		t.Fatalf("tentatives = %d, attendu 3", rt.calls)
	}
}

// 429 ×3 : budget épuisé → erreur remontée au caller (fallback).
func TestReply_FailsAfter429BudgetExhausted(t *testing.T) {
	rt := &scriptedRT{statuses: []int{429, 429, 429}}
	c := New("test-key", WithHTTPClient(&http.Client{Transport: rt}))

	if _, err := c.Reply(context.Background(), "sys", nil, "salut"); err == nil {
		t.Fatal("attendu une erreur après épuisement du budget 429")
	}
	if rt.calls != 3 {
		t.Fatalf("tentatives = %d, attendu 3", rt.calls)
	}
}

// 5xx : budget plus court (1 retry) — un 500 persistant n'est pas résolu en
// re-tentant vite.
func TestReply_RetriesOnceOn5xx(t *testing.T) {
	rt := &scriptedRT{statuses: []int{500}}
	c := New("test-key", WithHTTPClient(&http.Client{Transport: rt}))

	got, err := c.Reply(context.Background(), "sys", nil, "salut")
	if err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if got != "ok" {
		t.Fatalf("réponse = %q, attendu ok", got)
	}
	if rt.calls != 2 {
		t.Fatalf("tentatives = %d, attendu 2", rt.calls)
	}
}

func TestReply_FailsAfter5xxBudgetExhausted(t *testing.T) {
	rt := &scriptedRT{statuses: []int{500, 503}}
	c := New("test-key", WithHTTPClient(&http.Client{Transport: rt}))

	if _, err := c.Reply(context.Background(), "sys", nil, "salut"); err == nil {
		t.Fatal("attendu une erreur après épuisement du budget 5xx")
	}
	if rt.calls != 2 {
		t.Fatalf("tentatives = %d, attendu 2", rt.calls)
	}
}
