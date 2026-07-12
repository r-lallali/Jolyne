package ws

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ralys/jolyne/backend/internal/claudeapi"
	"github.com/ralys/jolyne/backend/internal/reports"
)

// analyzerBatchRT simule la Batch API (submit → ended → results) et, en cas
// de submitStatus ≠ 200, l'endpoint messages classique pour le repli direct.
type analyzerBatchRT struct {
	mu           sync.Mutex
	submitStatus int
	directCalls  int
}

func (rt *analyzerBatchRT) RoundTrip(req *http.Request) (*http.Response, error) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	respond := func(status int, body string) (*http.Response, error) {
		return &http.Response{
			StatusCode: status,
			Body:       io.NopCloser(strings.NewReader(body)),
			Header:     make(http.Header),
		}, nil
	}
	switch {
	case req.Method == http.MethodPost && strings.HasSuffix(req.URL.Path, "/batches"):
		if rt.submitStatus != 0 {
			return respond(rt.submitStatus, `{"type":"error","error":{"type":"overloaded_error"}}`)
		}
		// custom_id du 1er job d'un batcher neuf = "an-1".
		return respond(200, `{"id":"msgbatch_ws","processing_status":"in_progress"}`)
	case req.Method == http.MethodGet && strings.HasSuffix(req.URL.Path, "/results"):
		return respond(200, `{"custom_id":"an-1","result":{"type":"succeeded","message":`+
			`{"content":[{"type":"text","text":"{\"vocab\":[],\"mistakes\":[],\"cefr\":\"B1\"}"}]}}}`)
	case req.Method == http.MethodGet:
		return respond(200, `{"id":"msgbatch_ws","processing_status":"ended"}`)
	case req.Method == http.MethodPost:
		// Repli direct : endpoint messages classique.
		rt.directCalls++
		return respond(200, `{"content":[{"type":"text","text":"{\"vocab\":[],\"mistakes\":[],\"cefr\":\"A2\"}"}]}`)
	}
	return respond(404, `{}`)
}

func newBatcher(rt *analyzerBatchRT) *AnalysisBatcher {
	return &AnalysisBatcher{
		Claude:     claudeapi.New("test-key", claudeapi.WithHTTPClient(&http.Client{Transport: rt})),
		FlushEvery: 20 * time.Millisecond,
		PollEvery:  10 * time.Millisecond,
	}
}

func TestAnalysisBatcher_AppliesBatchResult(t *testing.T) {
	rt := &analyzerBatchRT{}
	b := newBatcher(rt)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	b.Start(ctx)

	got := make(chan string, 1)
	b.Enqueue("sys", "convo", func(_ context.Context, raw string) { got <- raw })

	select {
	case raw := <-got:
		if !strings.Contains(raw, `"cefr":"B1"`) {
			t.Fatalf("raw: %s", raw)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("résultat batch jamais appliqué")
	}
}

func TestAnalysisBatcher_FallsBackDirectOnSubmitError(t *testing.T) {
	rt := &analyzerBatchRT{submitStatus: 529}
	b := newBatcher(rt)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	b.Start(ctx)

	got := make(chan string, 1)
	b.Enqueue("sys", "convo", func(_ context.Context, raw string) { got <- raw })

	select {
	case raw := <-got:
		if !strings.Contains(raw, `"cefr":"A2"`) {
			t.Fatalf("raw: %s", raw)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("repli direct jamais appliqué")
	}
	rt.mu.Lock()
	defer rt.mu.Unlock()
	if rt.directCalls != 1 {
		t.Fatalf("appels directs: %d", rt.directCalls)
	}
}

// Au shutdown, Drain vide la file en appels directs (le résultat d'un lot ne
// pourrait jamais être appliqué par un process mort). La file n'est plus
// jetée par l'arrêt de la boucle Start.
func TestAnalysisBatcher_DrainRunsPendingDirect(t *testing.T) {
	rt := &analyzerBatchRT{}
	b := newBatcher(rt)

	got := make(chan string, 2)
	apply := func(_ context.Context, raw string) { got <- raw }
	b.Enqueue("sys", "convo 1", apply)
	b.Enqueue("sys", "convo 2", apply)

	drainCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	b.Drain(drainCtx)

	for i := 0; i < 2; i++ {
		select {
		case raw := <-got:
			if !strings.Contains(raw, `"cefr":"A2"`) {
				t.Fatalf("raw: %s", raw)
			}
		default:
			t.Fatalf("analyse %d non appliquée par le drain", i+1)
		}
	}
	// Une fois drainée, la file est vide — un second Drain est un no-op.
	b.Drain(drainCtx)

	rt.mu.Lock()
	defer rt.mu.Unlock()
	if rt.directCalls != 2 {
		t.Fatalf("appels directs: %d", rt.directCalls)
	}
}

// Avec un Batcher branché, Analyze n'appelle pas l'API : la requête rejoint
// la file en mémoire du batcher.
func TestAnalyze_EnqueuesWhenBatcherSet(t *testing.T) {
	rt := &analyzerBatchRT{}
	b := newBatcher(rt) // non démarré : la file reste observable
	s := &SessionAnalyzer{
		Claude:   claudeapi.New("test-key", claudeapi.WithHTTPClient(&http.Client{Transport: rt})),
		SaveWord: func(context.Context, int64, string, string, string, string) error { return nil },
		Batcher:  b,
	}
	msgs := make([]reports.CapturedMessage, 7)
	for i := range msgs {
		msgs[i] = reports.CapturedMessage{From: "Léa", Body: "hello this is message"}
	}
	s.Analyze(42, "Léa", "fr", "en", msgs)

	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.pending) != 1 {
		t.Fatalf("file batcher: %d éléments", len(b.pending))
	}
	if b.pending[0].convo == "" || b.pending[0].system == "" {
		t.Fatalf("job incomplet: %+v", b.pending[0])
	}
}
