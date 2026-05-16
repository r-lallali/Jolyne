package ws

import "encoding/json"

// Types de messages échangés sur la WebSocket. Le wire format est du JSON
// avec un champ discriminant `type`. Les contenus de message de chat ne
// sont JAMAIS loggés (CLAUDE.md règle d'or #1) — y compris les corrections.

// --- Client → Serveur ---

type ClientType string

const (
	ClientMsg     ClientType = "msg"
	ClientNext    ClientType = "next"
	ClientTyping  ClientType = "typing"
	ClientReport  ClientType = "report"
	ClientCorrect ClientType = "correct" // correction d'un message du peer
)

type ClientFrame struct {
	Type ClientType `json:"type"`
	Body string     `json:"body,omitempty"`

	// ID éphémère généré par le client (UUID court). Présent sur les frames
	// `msg` pour permettre au peer d'ancrer une correction dessus. Non
	// persisté, non loggé.
	ID string `json:"id,omitempty"`

	// Frame `correct` uniquement.
	TargetID string `json:"target_id,omitempty"` // ID du message à corriger
	Original string `json:"original,omitempty"`  // copie du message original
	Note     string `json:"note,omitempty"`      // note pédagogique optionnelle
}

// --- Serveur → Client ---

type ServerType string

const (
	ServerQueued     ServerType = "queued"
	ServerMatched    ServerType = "matched"
	ServerMsg        ServerType = "msg"
	ServerPeerLeft   ServerType = "peer_left"
	ServerTyping     ServerType = "typing"
	ServerReported   ServerType = "reported"
	ServerError      ServerType = "error"
	ServerCorrection ServerType = "correction" // correction reçue d'un peer
)

type ServerFrame struct {
	Type     ServerType `json:"type"`
	Room     string     `json:"room,omitempty"`
	PeerNick string     `json:"peer_nick,omitempty"`
	Body     string     `json:"body,omitempty"`
	Code     string     `json:"code,omitempty"`
	Message  string     `json:"message,omitempty"`

	// ID éphémère du message (frame `msg`) ou du message ciblé (`correction`).
	ID       string `json:"id,omitempty"`
	TargetID string `json:"target_id,omitempty"`
	Original string `json:"original,omitempty"`
	Note     string `json:"note,omitempty"`
}

// Codes d'erreur applicatifs (envoyés dans ServerFrame.Code).
const (
	ErrCodeInvalidParam   = "invalid_param"
	ErrCodeQueueTimeout   = "queue_timeout"
	ErrCodeQuotaExceeded  = "quota_exceeded"
	ErrCodeMessageBlocked = "message_blocked"
	ErrCodeMessageTooLong = "message_too_long"
	ErrCodeBanned         = "banned"
	ErrCodeInternal       = "internal"
)

func (s ServerFrame) Marshal() ([]byte, error) { return json.Marshal(s) }
