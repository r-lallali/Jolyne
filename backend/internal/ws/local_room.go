package ws

import (
	"context"
	"sync"
)

// roomTransport : abstraction du canal de conversation 1-vs-1. Deux
// implémentations : Room (Redis pub/sub, conversations humain-humain — requis
// pour un futur multi-instance) et localRoom (canaux in-process, conversations
// avec le prof IA — le bot vit dans le même process que la WS du user).
type roomTransport interface {
	Channel() <-chan roomEnvelope
	SendMsg(ctx context.Context, id, body string) error
	SendLeft(ctx context.Context) error
	SendJoin(ctx context.Context) error
	SendTyping(ctx context.Context) error
	SendCorrection(ctx context.Context, targetID, original, corrected, note string) error
	SendFriendAccept(ctx context.Context) error
	SendMissionComplete(ctx context.Context) error
	SendTandemPropose(ctx context.Context) error
	SendTandemAccept(ctx context.Context) error
	SendTandemSwitch(ctx context.Context, lang string) error
	SendTandemEnd(ctx context.Context) error
	Close() error
}

var (
	_ roomTransport = (*Room)(nil)
	_ roomTransport = (*localRoom)(nil)
)

// localRoomBuffer : profondeur du buffer par direction. Largement au-dessus du
// pire backlog réaliste (rafale pendant un appel Claude ~25 s : quelques
// messages + un typing/2 s). Buffer plein = on droppe, comme pub/sub sous
// pression — jamais de blocage de la boucle WS.
const localRoomBuffer = 128

// localRoom : extrémité d'un transport in-process (voir newLocalRoomPair).
// Le prof IA tourne dans le même process que la WS du user (BotManager et Hub
// sont in-memory, single-instance) : passer par Redis pub/sub n'apportait que
// des occasions de perdre des messages — fire-and-forget, aucune retransmission,
// un blip de la connexion subscriber suffit à rendre le prof « muet » ou
// « sourd ». Ici rien ne se perd : ce qui est publié avant que l'autre côté ne
// lise est simplement bufferisé.
type localRoom struct {
	recv chan roomEnvelope
	send chan roomEnvelope
	self chan struct{} // fermé par Close() de CE côté
	peer chan struct{} // = self de l'autre côté

	closeOnce sync.Once
}

// newLocalRoomPair crée les deux extrémités croisées d'une conversation
// in-process : ce que l'une publie arrive dans le buffer de l'autre. Pas de
// filtrage d'echo nécessaire (canaux directionnels).
func newLocalRoomPair() (a, b *localRoom) {
	ab := make(chan roomEnvelope, localRoomBuffer)
	ba := make(chan roomEnvelope, localRoomBuffer)
	da := make(chan struct{})
	db := make(chan struct{})
	a = &localRoom{recv: ba, send: ab, self: da, peer: db}
	b = &localRoom{recv: ab, send: ba, self: db, peer: da}
	return a, b
}

// Channel : canal de réception de ce côté. Contrairement à Room, il ne se
// ferme jamais (pas de reader à arrêter) : les consommateurs sortent sur un
// Left, l'annulation de contexte ou la fermeture de la connexion — jamais sur
// la fermeture du canal.
func (r *localRoom) Channel() <-chan roomEnvelope { return r.recv }

// publish dépose l'enveloppe dans le buffer de l'autre côté, sans jamais
// bloquer. Peer fermé = plus personne à livrer ; buffer plein (backlog
// pathologique) = on droppe silencieusement, même politique que pub/sub.
func (r *localRoom) publish(env roomEnvelope) error {
	select {
	case <-r.peer:
		return nil
	default:
	}
	select {
	case r.send <- env:
	default:
	}
	return nil
}

func (r *localRoom) SendMsg(_ context.Context, id, body string) error {
	return r.publish(roomEnvelope{Kind: roomKindMsg, ID: id, Body: body})
}

// SendLeft est le seul publish bloquant (borné par ctx — les callers passent
// un timeout court) : un Left droppé laisserait l'autre côté fixer un peer
// parti sans le savoir, alors qu'un msg/typing droppé est bénin.
func (r *localRoom) SendLeft(ctx context.Context) error {
	select {
	case r.send <- roomEnvelope{Kind: roomKindLeft}:
		return nil
	case <-r.peer:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (r *localRoom) SendJoin(_ context.Context) error {
	return r.publish(roomEnvelope{Kind: roomKindJoin})
}

func (r *localRoom) SendTyping(_ context.Context) error {
	return r.publish(roomEnvelope{Kind: roomKindTyping})
}

func (r *localRoom) SendCorrection(_ context.Context, targetID, original, corrected, note string) error {
	return r.publish(roomEnvelope{
		Kind:     roomKindCorrection,
		TargetID: targetID,
		Original: original,
		Body:     corrected,
		Note:     note,
	})
}

func (r *localRoom) SendFriendAccept(_ context.Context) error {
	return r.publish(roomEnvelope{Kind: roomKindFriendAccept})
}

func (r *localRoom) SendMissionComplete(_ context.Context) error {
	return r.publish(roomEnvelope{Kind: roomKindMission})
}

func (r *localRoom) SendTandemPropose(_ context.Context) error {
	return r.publish(roomEnvelope{Kind: roomKindTandemPropose})
}

func (r *localRoom) SendTandemAccept(_ context.Context) error {
	return r.publish(roomEnvelope{Kind: roomKindTandemAccept})
}

func (r *localRoom) SendTandemSwitch(_ context.Context, lang string) error {
	return r.publish(roomEnvelope{Kind: roomKindTandemSwitch, Body: lang})
}

func (r *localRoom) SendTandemEnd(_ context.Context) error {
	return r.publish(roomEnvelope{Kind: roomKindTandemEnd})
}

func (r *localRoom) Close() error {
	r.closeOnce.Do(func() { close(r.self) })
	return nil
}
