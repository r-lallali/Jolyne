package ws

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/redis/go-redis/v9"
)

// roomKind discrimine les évènements qui transitent sur le canal pub/sub
// d'une room. Le canal est utilisé par les 2 peers, donc chaque évènement
// porte un `from` pour permettre au receveur de filtrer son propre echo.
type roomKind string

const (
	roomKindMsg          roomKind = "msg"
	roomKindLeft         roomKind = "left"
	roomKindTyping       roomKind = "typing"
	roomKindCorrection   roomKind = "correction"
	roomKindFriendAccept roomKind = "friend_accept" // l'autre côté a accepté le prompt 10-min
)

type roomEnvelope struct {
	Kind roomKind `json:"k"`
	From string   `json:"f"`
	Body string   `json:"b,omitempty"`

	// ID éphémère du message (kind=msg) ou du message ciblé (kind=correction).
	ID       string `json:"i,omitempty"`
	TargetID string `json:"t,omitempty"`
	Original string `json:"o,omitempty"`
	Note     string `json:"n,omitempty"`
}

// Room enveloppe la souscription Redis pub/sub d'une conversation 1-vs-1.
// Chaque Conn matchée en ouvre une et la ferme via Close() au moment du
// "next" ou de la déconnexion (CLAUDE.md §Redis "désabonnement explicite").
type Room struct {
	rdb     *redis.Client
	channel string
	pubsub  *redis.PubSub
	selfID  string
}

func roomChannel(roomID string) string { return "room:" + roomID }

// openRoom souscrit immédiatement au canal Redis et bloque jusqu'à la
// confirmation de la souscription (sinon les premiers messages peuvent
// être perdus).
func openRoom(ctx context.Context, rdb *redis.Client, roomID, selfID string) (*Room, error) {
	ps := rdb.Subscribe(ctx, roomChannel(roomID))
	if _, err := ps.Receive(ctx); err != nil {
		_ = ps.Close()
		return nil, fmt.Errorf("room subscribe: %w", err)
	}
	return &Room{rdb: rdb, channel: roomChannel(roomID), pubsub: ps, selfID: selfID}, nil
}

// Channel renvoie le canal Redis dont les frames sont déjà filtrées du self.
func (r *Room) Channel() <-chan roomEnvelope {
	out := make(chan roomEnvelope, outboundBuffer)
	go func() {
		defer close(out)
		for raw := range r.pubsub.Channel() {
			var env roomEnvelope
			if err := json.Unmarshal([]byte(raw.Payload), &env); err != nil {
				continue
			}
			if env.From == r.selfID {
				continue
			}
			out <- env
		}
	}()
	return out
}

func (r *Room) publish(ctx context.Context, env roomEnvelope) error {
	env.From = r.selfID
	payload, err := json.Marshal(env)
	if err != nil {
		return fmt.Errorf("room marshal: %w", err)
	}
	if err := r.rdb.Publish(ctx, r.channel, payload).Err(); err != nil {
		return fmt.Errorf("room publish: %w", err)
	}
	return nil
}

// SendMsg publie un message texte (déjà sanitisé) au peer. `id` est l'ID
// éphémère généré par le client expéditeur — sert au peer à ancrer une
// éventuelle correction.
func (r *Room) SendMsg(ctx context.Context, id, body string) error {
	return r.publish(ctx, roomEnvelope{Kind: roomKindMsg, ID: id, Body: body})
}

// SendLeft signale au peer qu'on quitte la conversation (next / déconnexion).
func (r *Room) SendLeft(ctx context.Context) error {
	return r.publish(ctx, roomEnvelope{Kind: roomKindLeft})
}

// SendTyping signale au peer qu'on est en train de taper. Best-effort —
// le client throttle déjà à 1 émission toutes les 2s (voir useMatch.ts),
// le serveur ne fait que relayer.
func (r *Room) SendTyping(ctx context.Context) error {
	return r.publish(ctx, roomEnvelope{Kind: roomKindTyping})
}

// SendCorrection publie une correction d'un message du peer. `targetID`
// pointe vers le message d'origine, `original` est le texte initial conservé
// pour l'affichage côté receveur, `corrected` est la version proposée par le
// correcteur, `note` est une explication pédagogique optionnelle. Tous les
// textes sont déjà sanitisés.
func (r *Room) SendCorrection(ctx context.Context, targetID, original, corrected, note string) error {
	return r.publish(ctx, roomEnvelope{
		Kind:     roomKindCorrection,
		TargetID: targetID,
		Original: original,
		Body:     corrected,
		Note:     note,
	})
}

// SendFriendAccept signale au peer qu'on vient d'accepter le prompt ami
// 10-min. Quand les deux côtés ont publié, chacun crée la ligne friends
// (UPSERT idempotent) et envoie ServerFriendMade à son client.
func (r *Room) SendFriendAccept(ctx context.Context) error {
	return r.publish(ctx, roomEnvelope{Kind: roomKindFriendAccept})
}

func (r *Room) Close() error { return r.pubsub.Close() }
