package analytics

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"github.com/ralys/jolyne/backend/internal/netx"
	"github.com/ralys/jolyne/backend/internal/quota"
)

// maxPropsBytes borne la taille des métadonnées acceptées du beacon public —
// empêche un client d'injecter de gros payloads dans la table events.
const maxPropsBytes = 512

// Beacon est le handler HTTP public qui reçoit les événements front (page_view,
// signup_started, match_search_started). Il valide le nom contre l'allowlist
// PUBLIQUE, rate-limite par fingerprint, et n'enregistre jamais de PII.
type Beacon struct {
	Tracker *Tracker
	Quota   *quota.Engine
	// ResolveUser (optionnel) renvoie l'userID si un cookie de session valide
	// est présent, sinon 0. Permet d'attacher l'event à un compte connu.
	ResolveUser func(r *http.Request) int64
	// TrustedProxies : nombre de reverse-proxies frontaux (Traefik = 1) pour
	// résoudre l'IP cliente réelle sans se faire usurper par X-Forwarded-For.
	TrustedProxies int
	Log            *slog.Logger
}

type beaconBody struct {
	Name     string         `json:"name"`
	LangFrom string         `json:"lang_from"`
	LangTo   string         `json:"lang_to"`
	Props    map[string]any `json:"props"`
}

// Handler renvoie le http.HandlerFunc à monter sur POST /api/events.
//
// Répond toujours 204 (même en cas de rejet) : un beacon ne doit jamais
// renvoyer d'information exploitable à un client malveillant, et `sendBeacon`
// ignore de toute façon le corps de réponse.
func (b *Beacon) Handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		defer func() { w.WriteHeader(http.StatusNoContent) }()

		// Tracker absent (Postgres désactivé) → no-op silencieux.
		if b.Tracker == nil {
			return
		}

		var body beaconBody
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048)).Decode(&body); err != nil {
			return
		}
		if !ValidPublicName(body.Name) {
			return
		}

		fp := strings.TrimSpace(r.Header.Get("X-Device-FP"))
		var userID int64
		if b.ResolveUser != nil {
			userID = b.ResolveUser(r)
		}

		// Rate-limit anti-flood par identité (user si connecté, sinon
		// fingerprint). Sans identité on laisse passer mais sans corrélation.
		if b.Quota != nil {
			if id := quota.Identity(userID, fp); id != "" {
				if _, err := b.Quota.CheckAndIncrement(r.Context(), quota.KindBeacon, id, quota.BeaconDaily); err != nil {
					return // quota dépassé ou Redis KO : on jette en silence
				}
			}
		}

		props := body.Props
		if raw, err := json.Marshal(props); err != nil || len(raw) > maxPropsBytes {
			props = nil // payload trop gros / non sérialisable : on l'ignore
		}

		b.Tracker.Emit(Event{
			Name:     body.Name,
			UserID:   userID,
			AnonID:   HashID(fp),
			LangFrom: body.LangFrom,
			LangTo:   body.LangTo,
			IPHash:   HashID(netx.ClientIP(r, b.TrustedProxies)),
			Props:    props,
		})
	}
}
