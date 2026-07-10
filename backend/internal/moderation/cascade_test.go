package moderation

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ralys/jolyne/backend/internal/claudeapi"
)

// claudeRT compte les appels vers l'API Claude et renvoie un verdict fixe.
type claudeRT struct {
	calls   int
	verdict string
}

func (rt *claudeRT) RoundTrip(*http.Request) (*http.Response, error) {
	rt.calls++
	// Le verdict (du JSON) est imbriqué comme chaîne → échappement obligatoire.
	quoted, _ := json.Marshal(rt.verdict)
	body := `{"content":[{"type":"text","text":` + string(quoted) + `}]}`
	return &http.Response{
		StatusCode: 200,
		Body:       io.NopCloser(strings.NewReader(body)),
		Header:     make(http.Header),
	}, nil
}

func newCascade(t *testing.T, rt *claudeRT, scorerScore string, scorerStatus int) (*Classifier, *[]string) {
	t.Helper()
	client := claudeapi.New("test-key", claudeapi.WithHTTPClient(&http.Client{Transport: rt}))
	c := NewClassifier(client, nil)
	if scorerStatus != 0 {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(scorerStatus)
			_, _ = w.Write([]byte(scorerScore))
		}))
		t.Cleanup(srv.Close)
		c.Scorer = NewLocalScorer(srv.URL)
	}
	var stages []string
	c.Observe = func(stage string) { stages = append(stages, stage) }
	return c, &stages
}

func TestClassify_PrefilterNoLetters(t *testing.T) {
	rt := &claudeRT{verdict: `{"toxic":true,"category":"hate","severity":3}`}
	c, stages := newCascade(t, rt, "", 0)
	v := c.Classify(context.Background(), "👍👍 !!! 123")
	if v.Toxic || rt.calls != 0 {
		t.Fatalf("emoji/ponctuation = sain sans appel, got %+v calls=%d", v, rt.calls)
	}
	if len(*stages) != 1 || (*stages)[0] != "prefilter" {
		t.Fatalf("stages: %v", *stages)
	}
}

func TestClassify_LocalCleanSkipsClaude(t *testing.T) {
	rt := &claudeRT{verdict: `{"toxic":false,"category":"none","severity":0}`}
	c, stages := newCascade(t, rt, `{"score":0.02}`, 200)
	v := c.Classify(context.Background(), "bonjour comment ça va")
	if v.Toxic || rt.calls != 0 {
		t.Fatalf("score bas = sain sans Claude, got %+v calls=%d", v, rt.calls)
	}
	if len(*stages) != 1 || (*stages)[0] != "local_clean" {
		t.Fatalf("stages: %v", *stages)
	}
}

func TestClassify_LocalHighEscalatesToClaude(t *testing.T) {
	rt := &claudeRT{verdict: `{"toxic":true,"category":"harassment","severity":2}`}
	c, stages := newCascade(t, rt, `{"score":0.85}`, 200)
	v := c.Classify(context.Background(), "message limite")
	if !v.Toxic || v.Severity != 2 || rt.calls != 1 {
		t.Fatalf("la zone grise doit remonter à Claude, got %+v calls=%d", v, rt.calls)
	}
	if len(*stages) != 1 || (*stages)[0] != "claude" {
		t.Fatalf("stages: %v", *stages)
	}
}

func TestClassify_ScorerErrorFallsBackToClaude(t *testing.T) {
	rt := &claudeRT{verdict: `{"toxic":false,"category":"none","severity":0}`}
	c, stages := newCascade(t, rt, `boom`, 500)
	_ = c.Classify(context.Background(), "un message normal")
	if rt.calls != 1 {
		t.Fatalf("panne sidecar = comportement d'avant (Claude), calls=%d", rt.calls)
	}
	if len(*stages) != 2 || (*stages)[0] != "scorer_error" || (*stages)[1] != "claude" {
		t.Fatalf("stages: %v", *stages)
	}
}

func TestClassify_NoScorerGoesToClaude(t *testing.T) {
	rt := &claudeRT{verdict: `{"toxic":false,"category":"none","severity":0}`}
	c, _ := newCascade(t, rt, "", 0)
	_ = c.Classify(context.Background(), "un message normal")
	if rt.calls != 1 {
		t.Fatalf("sans scorer, Claude classe comme avant, calls=%d", rt.calls)
	}
}

func TestLocalScorer_RejectsOutOfRange(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"score":1.7}`))
	}))
	defer srv.Close()
	if _, err := NewLocalScorer(srv.URL).Score(context.Background(), "x"); err == nil {
		t.Fatal("score hors bornes doit être une erreur")
	}
}
