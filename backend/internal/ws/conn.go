package ws

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

// Timings du heartbeat (CLAUDE.md §Backend > WebSocket).
const (
	writeWait      = 10 * time.Second
	pingPeriod     = 15 * time.Second
	pongWait       = 30 * time.Second
	maxMessageSize = 4 << 10 // 4 KiB suffisent pour un message texte
	outboundBuffer = 32      // ≤ 32 par contrainte de backpressure
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1 << 10,
	WriteBufferSize: 1 << 10,
	// CheckOrigin doit être renforcé via config en prod — Phase 1 laisse
	// passer toutes les origines. À durcir avant ouverture publique.
	CheckOrigin: func(_ *http.Request) bool { return true },
}

// Conn enveloppe une connexion WebSocket avec ses canaux applicatifs.
// Un reader et un writer dédiés — jamais d'écriture concurrente sur le
// *websocket.Conn (CLAUDE.md §WebSocket).
type Conn struct {
	ws       *websocket.Conn
	Inbound  chan ClientFrame
	Outbound chan ServerFrame
	done     chan struct{}
}

func newConn(ws *websocket.Conn) *Conn {
	return &Conn{
		ws:       ws,
		Inbound:  make(chan ClientFrame, outboundBuffer),
		Outbound: make(chan ServerFrame, outboundBuffer),
		done:     make(chan struct{}),
	}
}

// Done est fermé dès que la connexion est fermée (peu importe le côté).
func (c *Conn) Done() <-chan struct{} { return c.done }

// WriteAndClose envoie UNE frame de manière synchrone puis ferme la conn.
// Utilisé pour les rejets fatals (ex: ban) où il faut garantir que le
// client reçoit la frame avant la fermeture.
func (c *Conn) WriteAndClose(f ServerFrame) {
	_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
	_ = c.ws.WriteJSON(f)
	c.close()
}

// Send pousse une frame vers le client. Non bloquant : si l'outbound est
// plein, la connexion est tuée (cf. CLAUDE.md "kill la connexion, ne jamais
// bloquer"). Renvoie false si non envoyée.
func (c *Conn) Send(f ServerFrame) bool {
	select {
	case c.Outbound <- f:
		return true
	default:
		c.close()
		return false
	}
}

func (c *Conn) close() {
	select {
	case <-c.done:
	default:
		close(c.done)
		_ = c.ws.Close()
	}
}

// Run lance les deux goroutines reader/writer. Bloque jusqu'à ce que la
// connexion se ferme.
func (c *Conn) Run(ctx context.Context) {
	go c.writer(ctx)
	c.reader(ctx)
}

func (c *Conn) reader(ctx context.Context) {
	defer c.close()
	c.ws.SetReadLimit(maxMessageSize)
	_ = c.ws.SetReadDeadline(time.Now().Add(pongWait))
	c.ws.SetPongHandler(func(string) error {
		return c.ws.SetReadDeadline(time.Now().Add(pongWait))
	})
	for {
		var f ClientFrame
		if err := c.ws.ReadJSON(&f); err != nil {
			return
		}
		select {
		case c.Inbound <- f:
		case <-ctx.Done():
			return
		case <-c.done:
			return
		default:
			// Inbound saturé : le handler n'absorbe pas assez vite, on coupe.
			return
		}
	}
}

func (c *Conn) writer(ctx context.Context) {
	defer c.close()
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()
	for {
		select {
		case f, ok := <-c.Outbound:
			if !ok {
				return
			}
			_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.ws.WriteJSON(f); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-ctx.Done():
			return
		case <-c.done:
			return
		}
	}
}

// Upgrade tente l'upgrade HTTP → WebSocket. Renvoie un Conn prêt à Run.
func Upgrade(w http.ResponseWriter, r *http.Request) (*Conn, error) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return nil, errors.Join(errors.New("ws upgrade"), err)
	}
	return newConn(ws), nil
}
