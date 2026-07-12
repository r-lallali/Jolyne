package claudeapi

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

// cannedRT renvoie une réponse fixe (statut + corps) à toute requête.
type cannedRT struct {
	status int
	body   string
}

func (rt *cannedRT) RoundTrip(*http.Request) (*http.Response, error) {
	return &http.Response{
		StatusCode: rt.status,
		Body:       io.NopCloser(strings.NewReader(rt.body)),
		Header:     make(http.Header),
	}, nil
}

type usageCapture struct {
	feature, outcome string
	in, out          int64
	calls            int
}

func (u *usageCapture) fn() UsageFunc {
	return func(feature, outcome string, in, out int64) {
		u.feature, u.outcome, u.in, u.out = feature, outcome, in, out
		u.calls++
	}
}

func TestReply_ReportsUsage(t *testing.T) {
	rt := &cannedRT{status: 200, body: `{"content":[{"type":"text","text":"ok"}],` +
		`"stop_reason":"end_turn","usage":{"input_tokens":123,"output_tokens":45}}`}
	var cap usageCapture
	c := New("test-key",
		WithHTTPClient(&http.Client{Transport: rt}),
		WithFeature("bot"),
		WithUsageFunc(cap.fn()),
	)
	if _, err := c.Reply(context.Background(), "sys", nil, "salut"); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if cap.calls != 1 || cap.feature != "bot" || cap.outcome != "ok" {
		t.Fatalf("observation inattendue: %+v", cap)
	}
	if cap.in != 123 || cap.out != 45 {
		t.Fatalf("tokens: in=%d out=%d", cap.in, cap.out)
	}
}

func TestReply_ReportsErrorOutcome(t *testing.T) {
	rt := &cannedRT{status: 400, body: `{"type":"error","error":{"type":"invalid_request_error"}}`}
	var cap usageCapture
	c := New("test-key",
		WithHTTPClient(&http.Client{Transport: rt}),
		WithFeature("bot"),
		WithUsageFunc(cap.fn()),
	)
	if _, err := c.Reply(context.Background(), "sys", nil, "salut"); err == nil {
		t.Fatal("erreur attendue")
	}
	if cap.calls != 1 || cap.outcome != "error" || cap.in != 0 || cap.out != 0 {
		t.Fatalf("observation inattendue: %+v", cap)
	}
}

func TestReply_DisabledDoesNotObserve(t *testing.T) {
	var cap usageCapture
	c := New("", WithUsageFunc(cap.fn()))
	if _, err := c.Reply(context.Background(), "sys", nil, "salut"); !errors.Is(err, ErrDisabled) {
		t.Fatalf("attendu ErrDisabled, got %v", err)
	}
	if cap.calls != 0 {
		t.Fatalf("aucune observation attendue, got %d", cap.calls)
	}
}

func TestForFeature_RelabelsCopy(t *testing.T) {
	rt := &cannedRT{status: 200, body: `{"content":[{"type":"text","text":"ok"}],` +
		`"usage":{"input_tokens":1,"output_tokens":1}}`}
	var cap usageCapture
	base := New("test-key",
		WithHTTPClient(&http.Client{Transport: rt}),
		WithUsageFunc(cap.fn()),
	)
	derived := base.ForFeature("moderation")
	if _, err := derived.Reply(context.Background(), "sys", nil, "x"); err != nil {
		t.Fatalf("Reply: %v", err)
	}
	if cap.feature != "moderation" {
		t.Fatalf("feature: %q", cap.feature)
	}
	// Le client de base reste non étiqueté → "unknown".
	if _, err := base.Reply(context.Background(), "sys", nil, "x"); err != nil {
		t.Fatalf("Reply base: %v", err)
	}
	if cap.feature != "unknown" {
		t.Fatalf("feature base: %q", cap.feature)
	}
}
