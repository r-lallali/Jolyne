// Package analytics journalise les événements métier (funnel, rétention) dans
// la table `events`. Chemin d'écriture uniquement — les agrégations de lecture
// pour les dashboards vivent dans internal/admin (stats_store.go).
//
// Privacy by default (cf. CLAUDE.md) : aucun contenu de message, email ou token
// ne transite par ici. Les noms d'événements sont validés contre une allowlist
// pour qu'un appel erroné (ou un beacon public malveillant) ne pollue pas la
// table.
package analytics

import (
	"crypto/sha256"
	"encoding/hex"
	"time"
)

// HashID renvoie les 8 premiers octets du sha256 en hex (même convention que
// hashClientIP côté admin). Sert à anonymiser fingerprints et IP avant stockage
// dans `events`. Renvoie "" pour une entrée vide.
func HashID(s string) string {
	if s == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:8])
}

// Noms canoniques des événements. Tout nom hors de cette liste est rejeté.
const (
	EventPageView           = "page_view"
	EventSignupStarted      = "signup_started"
	EventSignupCompleted    = "signup_completed"
	EventEmailVerified      = "email_verified"
	EventLogin              = "login"
	EventWSConnected        = "ws_connected"
	EventWSDisconnected     = "ws_disconnected"
	EventMatchSearchStarted = "match_search_started"
	EventMatchFound         = "match_found"
	EventBotFallback        = "bot_fallback"
	EventMessageSent        = "message_sent"
	EventConversationEnded  = "conversation_ended"
	EventNextSkipped        = "next_skipped"
	EventFriendAdded        = "friend_added"
	EventTranslateUsed      = "translate_used"
	EventPremiumCheckout    = "premium_checkout_started"
	EventPremiumActivated   = "premium_activated"
	EventPremiumCanceled    = "premium_canceled"
)

// allowed : tous les événements acceptés par le Tracker (serveur + beacon).
var allowed = map[string]struct{}{
	EventPageView:           {},
	EventSignupStarted:      {},
	EventSignupCompleted:    {},
	EventEmailVerified:      {},
	EventLogin:              {},
	EventWSConnected:        {},
	EventWSDisconnected:     {},
	EventMatchSearchStarted: {},
	EventMatchFound:         {},
	EventBotFallback:        {},
	EventMessageSent:        {},
	EventConversationEnded:  {},
	EventNextSkipped:        {},
	EventFriendAdded:        {},
	EventTranslateUsed:      {},
	EventPremiumCheckout:    {},
	EventPremiumActivated:   {},
	EventPremiumCanceled:    {},
}

// publicAllowed : sous-ensemble que le beacon public a le droit d'émettre. Les
// autres événements sont émis exclusivement côté serveur (un client ne peut pas
// les forger pour fausser le funnel).
var publicAllowed = map[string]struct{}{
	EventPageView:           {},
	EventSignupStarted:      {},
	EventMatchSearchStarted: {},
}

// ValidName indique si name fait partie de l'allowlist globale.
func ValidName(name string) bool {
	_, ok := allowed[name]
	return ok
}

// ValidPublicName indique si name peut légitimement provenir du beacon public.
func ValidPublicName(name string) bool {
	_, ok := publicAllowed[name]
	return ok
}

// Event est un événement métier. Les champs vides/zéro sont stockés NULL.
type Event struct {
	Name      string         // obligatoire, doit passer ValidName
	UserID    int64          // 0 = anonyme
	AnonID    string         // hash de fingerprint (corrélation pré-inscription)
	SessionID string         // id de session WS (éphémère)
	LangFrom  string         // code langue court, optionnel
	LangTo    string         // code langue court, optionnel
	IPHash    string         // 8 octets hex (cf. hashClientIP), optionnel
	Props     map[string]any // métadonnées courtes, non-PII, optionnel
	TS        time.Time      // défaut now() si zéro
}
