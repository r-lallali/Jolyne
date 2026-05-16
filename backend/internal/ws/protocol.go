package ws

import "encoding/json"

// Types de messages échangés sur la WebSocket. Le wire format est du JSON
// avec un champ discriminant `type`. Les contenus de message de chat ne
// sont JAMAIS loggés (CLAUDE.md règle d'or #1).

// --- Client → Serveur ---

type ClientType string

const (
	ClientMsg    ClientType = "msg"
	ClientNext   ClientType = "next"
	ClientTyping ClientType = "typing"
	ClientReport ClientType = "report"
)

type ClientFrame struct {
	Type ClientType `json:"type"`
	Body string     `json:"body,omitempty"`
}

// --- Serveur → Client ---

type ServerType string

const (
	ServerQueued   ServerType = "queued"
	ServerMatched  ServerType = "matched"
	ServerMsg      ServerType = "msg"
	ServerPeerLeft ServerType = "peer_left"
	ServerTyping   ServerType = "typing"
	ServerReported ServerType = "reported"
	ServerError    ServerType = "error"
)

type ServerFrame struct {
	Type     ServerType `json:"type"`
	Room     string     `json:"room,omitempty"`
	PeerNick string     `json:"peer_nick,omitempty"`
	Body     string     `json:"body,omitempty"`
	Code     string     `json:"code,omitempty"`
	Message  string     `json:"message,omitempty"`
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
