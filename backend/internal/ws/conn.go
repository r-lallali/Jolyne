package ws

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// Timings du heartbeat (CLAUDE.md règle d'or #5 : ping 15 s, kill à 30 s).
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
	CheckOrigin:     checkOrigin,
}

// allowedOrigins : origines autorisées à ouvrir un WebSocket. Configuré au boot
// via SetAllowedOrigins (front public). Vide = dev, on laisse tout passer.
var allowedOrigins = map[string]struct{}{}

// SetAllowedOrigins configure l'allowlist d'origines du handshake WS. À appeler
// une fois au câblage avec l'origine du front (et éventuels alias). Une liste
// vide désactive le contrôle (dev local sans cross-origin).
func SetAllowedOrigins(origins []string) {
	m := make(map[string]struct{}, len(origins))
	for _, o := range origins {
		o = strings.TrimRight(strings.TrimSpace(o), "/")
		if o != "" {
			m[o] = struct{}{}
		}
	}
	allowedOrigins = m
}

// checkOrigin défend contre le Cross-Site WebSocket Hijacking : sans contrôle,
// n'importe quel site pourrait ouvrir une WS avec le cookie de la victime. On
// exige que l'en-tête Origin corresponde à l'allowlist (ou au même host que la
// requête). Un handshake navigateur porte TOUJOURS Origin ; son absence en prod
// configuré = client hors périmètre → refus.
func checkOrigin(r *http.Request) bool {
	if len(allowedOrigins) == 0 {
		return true // dev : pas d'allowlist configurée
	}
	origin := strings.TrimRight(r.Header.Get("Origin"), "/")
	if origin == "" {
		return false
	}
	if _, ok := allowedOrigins[origin]; ok {
		return true
	}
	// Repli same-origin : l'Origin pointe vers le même host que la requête.
	if u, err := url.Parse(origin); err == nil && u.Host == r.Host {
		return true
	}
	return false
}

// Conn enveloppe une connexion WebSocket avec ses canaux applicatifs.
// Un reader et un writer dédiés — jamais d'écriture concurrente sur le
// *websocket.Conn (CLAUDE.md §WebSocket).
type Conn struct {
	ws       *websocket.Conn
	Inbound  chan ClientFrame
	Outbound chan any
	done     chan struct{}
}

func newConn(ws *websocket.Conn) *Conn {
	return &Conn{
		ws:       ws,
		Inbound:  make(chan ClientFrame, outboundBuffer),
		Outbound: make(chan any, outboundBuffer),
		done:     make(chan struct{}),
	}
}

// Done est fermé dès que la connexion est fermée (peu importe le côté).
func (c *Conn) Done() <-chan struct{} { return c.done }

// WriteAndClose envoie UNE frame de manière synchrone puis ferme la conn.
// Utilisé pour les rejets fatals (ex: ban) où il faut garantir que le
// client reçoit la frame avant la fermeture.
func (c *Conn) WriteAndClose(f any) {
	_ = c.ws.SetWriteDeadline(time.Now().Add(writeWait))
	_ = c.ws.WriteJSON(f)
	c.close()
}

// Send pousse une frame vers le client. Non bloquant : si l'outbound est
// plein, la connexion est tuée — kill plutôt que bloquer, un writer lent ne
// doit jamais figer la boucle de session. Renvoie false si non envoyée.
func (c *Conn) Send(f any) bool {
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
			// Le contexte de la requête est annulé dès que ServeHTTP rend la
			// main (runSession a return). Une dernière frame peut alors
			// dormir dans Outbound — typiquement l'erreur terminale
			// (quota_exceeded / queue_timeout) émise juste avant le return.
			// Sans ce flush, la course annulation↔écriture la perd : le
			// client ne reçoit jamais la raison, ne marque pas l'erreur comme
			// fatale et se reconnecte en boucle (recherche infinie). Le reader
			// reste bloqué dans ReadJSON, donc pas d'écriture concurrente sur
			// le socket pendant le drain.
			c.flushPending()
			return
		case <-c.done:
			return
		}
	}
}

// flushPending vide le tampon Outbound sur le socket, sans bloquer. Appelé
// uniquement par le writer (donc jamais d'écriture concurrente) au moment
// d'un arrêt sur annulation de contexte — garantit la livraison des frames
// déjà en file avant la fermeture.
func (c *Conn) flushPending() {
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
		default:
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
