package ws

import (
	"sync"

	"github.com/ralys/jolyne/backend/internal/session"
)

// WakeupEvent informe une session en attente qu'elle a été matchée.
type WakeupEvent struct {
	RoomID   string
	PeerNick string
	PeerID   string // utilisé pour éviter de re-matcher avec ce peer après un Next
}

// pending est l'entrée du registre par sessionID en attente.
type pending struct {
	sess   session.Session
	wakeup chan WakeupEvent
}

// Hub maintient un registre en mémoire des sessions actuellement en attente
// d'un peer. Single-instance pour le MVP : suffit tant qu'on n'a qu'un seul
// process Go derrière Caddy. À remplacer par Redis pub/sub si on scale out.
type Hub struct {
	mu       sync.RWMutex
	sessions map[string]*pending
}

func NewHub() *Hub {
	return &Hub{sessions: make(map[string]*pending)}
}

// Register inscrit une session et renvoie son canal de réveil. Un slot par
// session : si déjà présent (re-register), la précédente est remplacée
// (et son canal fermé).
func (h *Hub) Register(s session.Session) <-chan WakeupEvent {
	h.mu.Lock()
	defer h.mu.Unlock()
	if old, ok := h.sessions[s.ID]; ok {
		close(old.wakeup)
	}
	p := &pending{sess: s, wakeup: make(chan WakeupEvent, 1)}
	h.sessions[s.ID] = p
	return p.wakeup
}

// Unregister retire la session du Hub et ferme son canal.
func (h *Hub) Unregister(sessionID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if p, ok := h.sessions[sessionID]; ok {
		close(p.wakeup)
		delete(h.sessions, sessionID)
	}
}

// Lookup renvoie la session si encore enregistrée.
func (h *Hub) Lookup(sessionID string) (session.Session, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	p, ok := h.sessions[sessionID]
	if !ok {
		return session.Session{}, false
	}
	return p.sess, true
}

// Wakeup notifie une session en attente qu'elle a été matchée. Non bloquant :
// si le canal est plein ou la session disparue, renvoie false.
func (h *Hub) Wakeup(sessionID string, ev WakeupEvent) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	p, ok := h.sessions[sessionID]
	if !ok {
		return false
	}
	select {
	case p.wakeup <- ev:
		return true
	default:
		return false
	}
}
