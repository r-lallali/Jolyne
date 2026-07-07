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
	// UserID > 0 si la WS a été ouverte avec un cookie de session user
	// valide. 0 = anonyme. Sert au flow ami (10-min prompt + match
	// mutuel) qui n'est proposé QUE si les deux peers sont authentifiés.
	UserID int64
	// Scenario : jeu de rôle du prof IA choisi sur l'écran de setup
	// (restaurant, interview…). Vide = chat libre. Seulement pertinent en
	// mode bot — validé contre le catalogue ws.botScenarios au handshake.
	Scenario string
	// CEFR : niveau CECRL estimé (1.0..6.0, 0 = inconnu/anonyme). Résolu au
	// handshake depuis users.cefr_score — sert à la préférence de niveau du
	// matcher et au calibrage du prof IA.
	CEFR float64
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
