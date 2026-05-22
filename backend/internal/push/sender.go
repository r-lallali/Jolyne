package push

import (
	"context"
	"encoding/json"
	"log/slog"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// Sender : envoie des notifications Web Push aux appareils d'un user.
// Best-effort — les erreurs 410/404 sont traitées comme un signal de
// désabonnement automatique (l'endpoint est purgé de la DB).
type Sender struct {
	Store      *Store
	VAPIDPub   string
	VAPIDPriv  string
	VAPIDSubj  string // mailto: ... ou URL d'identification (RFC 8292)
	Log        *slog.Logger
}

// Payload : ce qui arrive au Service Worker côté client. Aucun contenu
// brut de message ici — `Body` est tronqué côté caller. Aucune log de
// `Body` côté serveur (CLAUDE.md règle d'or #1).
type Payload struct {
	Title    string `json:"title"`
	Body     string `json:"body"`
	Icon     string `json:"icon,omitempty"`
	URL      string `json:"url"`
	FriendID int64  `json:"friend_id"`
	Tag      string `json:"tag,omitempty"`
}

// SendToUser : pousse la même notification à tous les appareils
// enregistrés du user. À appeler depuis une goroutine — pas bloquant
// pour l'envoi de message.
func (s *Sender) SendToUser(ctx context.Context, userID int64, payload Payload) {
	if s == nil || s.Store == nil || s.VAPIDPriv == "" {
		return
	}
	subs, err := s.Store.ListForUser(ctx, userID)
	if err != nil {
		if s.Log != nil {
			s.Log.Warn("push list subscriptions failed", "err", err, "uid", userID)
		}
		return
	}
	if len(subs) == 0 {
		return
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return
	}
	for _, sub := range subs {
		s.sendOne(ctx, sub, body)
	}
}

func (s *Sender) sendOne(ctx context.Context, sub Subscription, payload []byte) {
	ws := &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys: webpush.Keys{
			P256dh: sub.P256dh,
			Auth:   sub.Auth,
		},
	}
	resp, err := webpush.SendNotificationWithContext(ctx, payload, ws, &webpush.Options{
		Subscriber:      s.VAPIDSubj,
		VAPIDPublicKey:  s.VAPIDPub,
		VAPIDPrivateKey: s.VAPIDPriv,
		TTL:             86400, // 24h — au-delà, la notif n'est plus pertinente
		Urgency:         webpush.UrgencyNormal,
	})
	if err != nil {
		// erreur réseau ou JWT — on log et on laisse, pas de désabonnement
		if s.Log != nil {
			s.Log.Warn("push send failed", "err", err)
		}
		return
	}
	defer resp.Body.Close()
	// 404 / 410 : endpoint mort, on purge.
	if resp.StatusCode == 404 || resp.StatusCode == 410 {
		_ = s.Store.DeleteByEndpoint(ctx, sub.Endpoint)
	}
}
