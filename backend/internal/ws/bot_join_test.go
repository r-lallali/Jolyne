package ws

import (
	"context"
	"testing"
	"time"
)

// waitForPeerJoin doit renvoyer joined=true dès qu'un signe de présence du
// user arrive (join/typing) — c'est ce qui débloque l'envoi du greeting sans
// le publier dans le vide.
func TestWaitForPeerJoin_ReturnsOnJoin(t *testing.T) {
	m := &BotManager{}
	for _, kind := range []roomKind{roomKindJoin, roomKindTyping} {
		events := make(chan roomEnvelope, 1)
		events <- roomEnvelope{Kind: kind}
		pending, joined, ok := m.waitForPeerJoin(context.Background(), events)
		if !ok || !joined {
			t.Fatalf("kind %q: attendu présence (joined=true, ok=true)", kind)
		}
		if pending != nil {
			t.Fatalf("kind %q: pas de message en attente attendu", kind)
		}
	}
}

// Un message reçu pendant l'attente (join perdu) confirme la présence ET doit
// être restitué au caller pour recevoir une réponse — jamais avalé (sinon le
// prof IA « ignore » le premier message du user).
func TestWaitForPeerJoin_ReturnsPendingMsg(t *testing.T) {
	m := &BotManager{}
	events := make(chan roomEnvelope, 1)
	events <- roomEnvelope{Kind: roomKindMsg, Body: "bonjour"}
	pending, joined, ok := m.waitForPeerJoin(context.Background(), events)
	if !ok || !joined {
		t.Fatal("msg pendant l'attente : attendu joined=true, ok=true")
	}
	if pending == nil || pending.Body != "bonjour" {
		t.Fatalf("pending = %+v, attendu le message %q", pending, "bonjour")
	}
}

// Le user quitte avant d'avoir parlé → pas de greeting (ok=false).
func TestWaitForPeerJoin_ReturnsFalseOnLeft(t *testing.T) {
	m := &BotManager{}
	events := make(chan roomEnvelope, 1)
	events <- roomEnvelope{Kind: roomKindLeft}
	if _, _, ok := m.waitForPeerJoin(context.Background(), events); ok {
		t.Fatal("left avant join : attendu ok=false")
	}
}

// Canal fermé (room coupée) → ok=false, pas de blocage.
func TestWaitForPeerJoin_ReturnsFalseOnClosedChannel(t *testing.T) {
	m := &BotManager{}
	events := make(chan roomEnvelope)
	close(events)
	if _, _, ok := m.waitForPeerJoin(context.Background(), events); ok {
		t.Fatal("canal fermé : attendu ok=false")
	}
}

// Timer de repli : sans aucun signe de vie, on sort avec ok=true mais
// joined=false — le caller enverra le greeting et le re-publiera au premier
// signe de présence tardif.
func TestWaitForPeerJoin_FallbackTimerNotJoined(t *testing.T) {
	m := &BotManager{}
	events := make(chan roomEnvelope) // jamais alimenté
	pending, joined, ok := m.waitForPeerJoin(context.Background(), events)
	if !ok {
		t.Fatal("timer de repli : attendu ok=true")
	}
	if joined {
		t.Fatal("timer de repli : attendu joined=false (présence non confirmée)")
	}
	if pending != nil {
		t.Fatal("timer de repli : pas de message en attente attendu")
	}
}

// Contexte annulé → ok=false immédiat (pas d'attente du timeout de fallback).
func TestWaitForPeerJoin_ReturnsFalseOnCtxCancel(t *testing.T) {
	m := &BotManager{}
	events := make(chan roomEnvelope) // jamais alimenté
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	done := make(chan bool, 1)
	go func() {
		_, _, ok := m.waitForPeerJoin(ctx, events)
		done <- ok
	}()
	select {
	case got := <-done:
		if got {
			t.Fatal("ctx annulé : attendu ok=false")
		}
	case <-time.After(time.Second):
		t.Fatal("waitForPeerJoin n'a pas réagi à l'annulation du contexte")
	}
}
