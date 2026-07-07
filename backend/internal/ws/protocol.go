package ws

import "encoding/json"

// Types de messages échangés sur la WebSocket. Le wire format est du JSON
// avec un champ discriminant `type`. Les contenus de message de chat ne
// sont JAMAIS loggés (CLAUDE.md règle d'or #1) — y compris les corrections.

// --- Client → Serveur ---

type ClientType string

const (
	ClientMsg             ClientType = "msg"
	ClientNext            ClientType = "next"
	ClientTyping          ClientType = "typing"
	ClientReport          ClientType = "report"
	ClientCorrect         ClientType = "correct"        // correction d'un message du peer
	ClientFriendAccept    ClientType = "friend_accept"  // réponse au friend_prompt (10 min)
	ClientFriendEditMsg   ClientType = "edit_msg"       // (chat ami) édition d'un message persisté
	ClientFriendDeleteMsg ClientType = "delete_msg"     // (chat ami) suppression soft d'un message
	ClientTandemPropose   ClientType = "tandem_propose" // propose une session tandem 50/50
	ClientTandemAccept    ClientType = "tandem_accept"  // accepte la proposition tandem du peer
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
	ServerQueued            ServerType = "queued"
	ServerMatched           ServerType = "matched"
	ServerMsg               ServerType = "msg"
	ServerPeerLeft          ServerType = "peer_left"
	ServerTyping            ServerType = "typing"
	ServerReported          ServerType = "reported"
	ServerError             ServerType = "error"
	ServerCorrection        ServerType = "correction"         // correction reçue d'un peer
	ServerFriendPrompt      ServerType = "friend_prompt"      // "tu veux ajouter ce peer ?"
	ServerFriendMade        ServerType = "friend_made"        // les deux ont accepté
	ServerFriendSkipped     ServerType = "friend_skipped"     // fenêtre expirée sans match
	ServerPeerProfile       ServerType = "peer_profile"       // peer authentifié : avatar + prompts
	ServerModerationWarning ServerType = "moderation_warning" // message jugé toxique par l'IA
	ServerNudge             ServerType = "nudge"              // rappel pédagogique privé (langue pratiquée)
	ServerIcebreakers       ServerType = "icebreakers"        // amorces de conversation fraîches (post-match)
	ServerMissionComplete   ServerType = "mission_complete"   // mission du scénario roleplay accomplie

	// Tandem 50/50 : session structurée moitié langue A, moitié langue B.
	// `tandem_prompt` = le peer propose ; `tandem_switch` = début de phase
	// (Body = code langue de la phase, WindowSec = durée) ; `tandem_end` =
	// session terminée, retour au chat libre.
	ServerTandemPrompt ServerType = "tandem_prompt"
	ServerTandemSwitch ServerType = "tandem_switch"
	ServerTandemEnd    ServerType = "tandem_end"
)

// Codes de nudge (ServerFrame.Code sur une frame `nudge`). Le front mappe le
// code vers un libellé i18n — le serveur n'envoie jamais de texte libre.
const (
	NudgePracticeLang = "practice_lang" // trop de messages consécutifs en langue native
	NudgeTandemLang   = "tandem_lang"   // mauvaise langue pendant une phase tandem 50/50
)

// ServerPrompt : libellé i18n côté front. Vide si slot non rempli.
type ServerPrompt struct {
	Prompt string `json:"prompt"`
	Answer string `json:"answer"`
}

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

	// Frame `friend_made` : ID de la ligne friends côté DB pour ouvrir le
	// chat persisté côté client. Frame `friend_prompt` : window en
	// secondes pendant laquelle on attend la réponse mutuelle.
	FriendID  int64 `json:"friend_id,omitempty"`
	WindowSec int   `json:"window_sec,omitempty"`

	// Frame `peer_profile` : photo principale Cloudinary (public_id) +
	// 3 slots Q&R. Affichés en sidebar pendant le chat anonyme.
	PeerPhotoID  string         `json:"peer_photo_id,omitempty"`
	PeerPrompts  []ServerPrompt `json:"peer_prompts,omitempty"`
	PeerVerified bool           `json:"peer_verified,omitempty"`
	// Niveau CECRL estimé du peer (1.0..6.0, 0 = inconnu). Le front convertit
	// en libellé « ≈ B1 ».
	PeerCEFR float64 `json:"peer_cefr,omitempty"`

	// Frame `matched` : indique que le peer est un bot prof IA. Le front
	// affiche un badge "🤖 Prof IA" et n'affiche pas le prompt friend.
	IsBot bool `json:"is_bot,omitempty"`

	// Frame `icebreakers` : amorces dans la langue pratiquée, affichées en
	// chips au-dessus de l'input tant que la conversation est vide.
	Suggestions []string `json:"suggestions,omitempty"`
}

// Codes d'erreur applicatifs (envoyés dans ServerFrame.Code).
const (
	ErrCodeInvalidParam     = "invalid_param"
	ErrCodeQueueTimeout     = "queue_timeout"
	ErrCodeQuotaExceeded    = "quota_exceeded"     // swipe (nouveaux partenaires)
	ErrCodeBotQuotaExceeded = "bot_quota_exceeded" // messages au prof IA
	ErrCodeScenarioPremium  = "scenario_premium"   // scénario réservé aux abonnés
	ErrCodeMessageBlocked   = "message_blocked"
	ErrCodeMessageTooLong   = "message_too_long"
	ErrCodeBanned           = "banned"
	ErrCodeInternal         = "internal"
)

func (s ServerFrame) Marshal() ([]byte, error) { return json.Marshal(s) }
