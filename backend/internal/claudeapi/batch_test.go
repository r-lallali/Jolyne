package claudeapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

// batchRT simule les trois endpoints de la Batch API. Les statuts renvoyés
// par GET /batches/{id} sont consommés dans l'ordre (in_progress → ended).
type batchRT struct {
	submitBody []byte
	statuses   []string
	resultsRaw string
	submitErr  int // statut HTTP à renvoyer au submit (0 = 200)
}

func (rt *batchRT) RoundTrip(req *http.Request) (*http.Response, error) {
	respond := func(status int, body string) (*http.Response, error) {
		return &http.Response{
			StatusCode: status,
			Body:       io.NopCloser(strings.NewReader(body)),
			Header:     make(http.Header),
		}, nil
	}
	switch {
	case req.Method == http.MethodPost && strings.HasSuffix(req.URL.Path, "/batches"):
		rt.submitBody, _ = io.ReadAll(req.Body)
		if rt.submitErr != 0 {
			return respond(rt.submitErr, `{"type":"error","error":{"type":"overloaded_error"}}`)
		}
		return respond(200, `{"id":"msgbatch_test","processing_status":"in_progress"}`)
	case req.Method == http.MethodGet && strings.HasSuffix(req.URL.Path, "/results"):
		return respond(200, rt.resultsRaw)
	case req.Method == http.MethodGet:
		status := "ended"
		if len(rt.statuses) > 0 {
			status, rt.statuses = rt.statuses[0], rt.statuses[1:]
		}
		return respond(200, `{"id":"msgbatch_test","processing_status":"`+status+`"}`)
	}
	return respond(404, `{}`)
}

func TestSubmitBatch_SendsRequests(t *testing.T) {
	rt := &batchRT{}
	c := New("test-key", WithHTTPClient(&http.Client{Transport: rt}), WithMaxTokens(512))
	id, err := c.SubmitBatch(context.Background(), []BatchItem{
		{CustomID: "an-1", System: "sys", UserMsg: "convo"},
	})
	if err != nil {
		t.Fatalf("SubmitBatch: %v", err)
	}
	if id != "msgbatch_test" {
		t.Fatalf("id: %q", id)
	}
	var sent batchCreateRequest
	if err := json.Unmarshal(rt.submitBody, &sent); err != nil {
		t.Fatalf("decode submit: %v", err)
	}
	if len(sent.Requests) != 1 {
		t.Fatalf("requests: %+v", sent.Requests)
	}
	r := sent.Requests[0]
	if r.CustomID != "an-1" || r.Params.System != "sys" || r.Params.MaxTokens != 512 {
		t.Fatalf("params: %+v", r)
	}
	if len(r.Params.Messages) != 1 || r.Params.Messages[0].Role != "user" {
		t.Fatalf("messages: %+v", r.Params.Messages)
	}
}

func TestBatchEnded_FollowsStatus(t *testing.T) {
	rt := &batchRT{statuses: []string{"in_progress", "ended"}}
	c := New("test-key", WithHTTPClient(&http.Client{Transport: rt}))
	if ended, err := c.BatchEnded(context.Background(), "msgbatch_test"); err != nil || ended {
		t.Fatalf("1er poll: ended=%v err=%v", ended, err)
	}
	if ended, err := c.BatchEnded(context.Background(), "msgbatch_test"); err != nil || !ended {
		t.Fatalf("2e poll: ended=%v err=%v", ended, err)
	}
}

func TestBatchResults_MapsByCustomID(t *testing.T) {
	rt := &batchRT{resultsRaw: `{"custom_id":"an-1","result":{"type":"succeeded","message":` +
		`{"content":[{"type":"text","text":"resultat-1"}],"usage":{"input_tokens":10,"output_tokens":5}}}}` + "\n" +
		`{"custom_id":"an-2","result":{"type":"errored"}}` + "\n"}
	var cap usageCapture
	c := New("test-key",
		WithHTTPClient(&http.Client{Transport: rt}),
		WithFeature("analyzer"),
		WithUsageFunc(cap.fn()),
	)
	results, err := c.BatchResults(context.Background(), "msgbatch_test")
	if err != nil {
		t.Fatalf("BatchResults: %v", err)
	}
	if len(results) != 1 || results["an-1"] != "resultat-1" {
		t.Fatalf("results: %+v", results)
	}
	// Deux observations : le succès (tokens) et l'échec.
	if cap.calls != 2 {
		t.Fatalf("observations: %d", cap.calls)
	}
}

func TestSubmitBatch_EmptyRejected(t *testing.T) {
	c := New("test-key", WithHTTPClient(&http.Client{Transport: &batchRT{}}))
	if _, err := c.SubmitBatch(context.Background(), nil); err == nil {
		t.Fatal("batch vide doit être rejeté")
	}
}
