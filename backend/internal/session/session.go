package session

import "github.com/google/uuid"

// Session représente un utilisateur connecté pour la durée d'une connexion WS.
// Anonyme par défaut : pas d'email, pas de compte. L'identifiant durable est
// le fingerprint device (côté client : FingerprintJS) — voir CLAUDE.md.
type Session struct {
	ID          string // UUID éphémère par connexion WS
	Pseudo      string // 3-20 chars, déjà validé par le package moderation
	Speaks      string // code ISO 639-1 minuscule (fr, en, es, de)
	Wants       string // idem
	Fingerprint string // ID device opaque (hash côté client)
	IPHash      string // IP hashée — jamais l'IP brute (RGPD)
	Plan        Plan
}

type Plan string

const (
	PlanFree    Plan = "free"
	PlanPremium Plan = "premium"
)

func New(pseudo, speaks, wants, fingerprint, ipHash string, plan Plan) Session {
	return Session{
		ID:          uuid.NewString(),
		Pseudo:      pseudo,
		Speaks:      speaks,
		Wants:       wants,
		Fingerprint: fingerprint,
		IPHash:      ipHash,
		Plan:        plan,
	}
}
