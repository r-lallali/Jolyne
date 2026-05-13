//go:build e2e

package ws_test

import (
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/ralys/jolyne/backend/internal/ws"
)

// Test e2e — nécessite un gateway en local (cf. docker-compose.dev.yml).
// Lancer avec : GATEWAY_URL=ws://localhost:8080 go test -tags=e2e -run TestMatch -count=1 ./internal/ws/...
//
// Le test connecte 2 clients aux langues miroirs, vérifie le match,
// l'échange d'un message, le "next" et le peer_left.
func TestMatch(t *testing.T) {
	base := os.Getenv("GATEWAY_URL")
	if base == "" {
		base = "ws://localhost:8080"
	}
	a := dial(t, base, "alice", "fr", "en", "fp-a")
	defer a.Close()
	b := dial(t, base, "bob", "en", "fr", "fp-b")
	defer b.Close()

	// Les deux doivent recevoir "matched" — pas forcément dans l'ordre.
	expectMatched(t, a, "bob")
	expectMatched(t, b, "alice")

	// Alice envoie, Bob reçoit. Le serveur ne réécrit pas le contenu — la
	// défense XSS est assurée côté client (DOMPurify + React text node).
	send(t, a, ws.ClientFrame{Type: ws.ClientMsg, Body: "hello bob"})
	bob := recv(t, b)
	if bob.Type != ws.ServerMsg {
		t.Fatalf("bob got %s, want msg", bob.Type)
	}
	if bob.Body != "hello bob" {
		t.Fatalf("bob body = %q, want %q", bob.Body, "hello bob")
	}

	// Alice "next" → Bob doit recevoir peer_left.
	send(t, a, ws.ClientFrame{Type: ws.ClientNext})
	left := recv(t, b)
	if left.Type != ws.ServerPeerLeft {
		t.Fatalf("bob got %s, want peer_left", left.Type)
	}
}

func dial(t *testing.T, base, nick, speaks, wants, fp string) *websocket.Conn {
	t.Helper()
	u, _ := url.Parse(base + "/ws/match")
	q := u.Query()
	q.Set("nick", nick)
	q.Set("speaks", speaks)
	q.Set("wants", wants)
	q.Set("fp", fp)
	q.Set("age", "ok")
	u.RawQuery = q.Encode()
	c, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		t.Fatalf("dial %s: %v", nick, err)
	}
	return c
}

func send(t *testing.T, c *websocket.Conn, f ws.ClientFrame) {
	t.Helper()
	if err := c.WriteJSON(f); err != nil {
		t.Fatalf("write: %v", err)
	}
}

func recv(t *testing.T, c *websocket.Conn) ws.ServerFrame {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	var f ws.ServerFrame
	if err := c.ReadJSON(&f); err != nil {
		t.Fatalf("read: %v", err)
	}
	return f
}

// expectMatched lit au plus 2 frames (un "queued" éventuel puis le "matched").
func expectMatched(t *testing.T, c *websocket.Conn, wantPeer string) {
	t.Helper()
	for i := 0; i < 2; i++ {
		f := recv(t, c)
		if f.Type == ws.ServerMatched {
			if f.PeerNick != wantPeer {
				t.Fatalf("peer_nick = %q, want %q", f.PeerNick, wantPeer)
			}
			return
		}
	}
	t.Fatalf("never got matched frame")
}
