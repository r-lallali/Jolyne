package claudeapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

// captureRT intercepte la requête HTTP sortante et renvoie une réponse canned,
// pour inspecter le corps envoyé à l'API sans réseau.
type captureRT struct{ body []byte }

func (rt *captureRT) RoundTrip(req *http.Request) (*http.Response, error) {
	rt.body, _ = io.ReadAll(req.Body)
	const ok = `{"content":[{"type":"text","text":"ok"}],"stop_reason":"end_turn"}`
	return &http.Response{
		StatusCode: 200,
		Body:       io.NopCloser(strings.NewReader(ok)),
		Header:     make(http.Header),
	}, nil
}

func sentMessages(t *testing.T, body []byte) []Message {
	t.Helper()
	var req messagesRequest
	if err := json.Unmarshal(body, &req); err != nil {
		t.Fatalf("decode request: %v", err)
	}
	return req.Messages
}

// Un historique ouvrant sur un tour "assistant" (greeting du bot) doit être
// rogné pour que le 1er message envoyé soit "user" — sinon l'API renvoie 400
// et le bot ne répond plus aux messages suivants.
func TestReply_TrimsLeadingAssistant(t *testing.T) {
	rt := &captureRT{}
	c := New("test-key", WithHTTPClient(&http.Client{Transport: rt}))

	history := []Message{{Role: "assistant", Content: "Bonjour !"}}
	if _, err := c.Reply(context.Background(), "sys", history, "ça va ?"); err != nil {
		t.Fatalf("Reply: %v", err)
	}

	msgs := sentMessages(t, rt.body)
	if len(msgs) == 0 {
		t.Fatal("aucun message envoyé")
	}
	if msgs[0].Role != "user" {
		t.Fatalf("premier message: attendu role=user, got %q", msgs[0].Role)
	}
	// Le tour assistant de tête a été rogné → il ne reste que le message user.
	if len(msgs) != 1 || msgs[0].Content != "ça va ?" {
		t.Fatalf("messages inattendus: %+v", msgs)
	}
}

// Un historique valide (commence par "user") est transmis intact.
func TestReply_KeepsValidHistory(t *testing.T) {
	rt := &captureRT{}
	c := New("test-key", WithHTTPClient(&http.Client{Transport: rt}))

	history := []Message{
		{Role: "user", Content: "amorce"},
		{Role: "assistant", Content: "Bonjour !"},
	}
	if _, err := c.Reply(context.Background(), "sys", history, "ça va ?"); err != nil {
		t.Fatalf("Reply: %v", err)
	}

	msgs := sentMessages(t, rt.body)
	if len(msgs) != 3 || msgs[0].Role != "user" || msgs[2].Content != "ça va ?" {
		t.Fatalf("historique non préservé: %+v", msgs)
	}
}
