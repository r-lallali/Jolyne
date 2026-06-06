package ws

import (
	"context"
	"testing"
	"time"
)

// waitForPeerJoin doit renvoyer true dès qu'un signe de présence du user
// arrive (join/msg/typing) — c'est ce qui débloque l'envoi du greeting sans
// le publier dans le vide.
func TestWaitForPeerJoin_ReturnsOnJoin(t *testing.T) {
	m := &BotManager{}
	for _, kind := range []roomKind{roomKindJoin, roomKindMsg, roomKindTyping} {
		events := make(chan roomEnvelope, 1)
		events <- roomEnvelope{Kind: kind}
		if !m.waitForPeerJoin(context.Background(), events) {
			t.Fatalf("kind %q: attendu présence (true)", kind)
		}
	}
}

// Le user quitte avant d'avoir parlé → pas de greeting (false).
func TestWaitForPeerJoin_ReturnsFalseOnLeft(t *testing.T) {
	m := &BotManager{}
	events := make(chan roomEnvelope, 1)
	events <- roomEnvelope{Kind: roomKindLeft}
	if m.waitForPeerJoin(context.Background(), events) {
		t.Fatal("left avant join : attendu false")
	}
}

// Canal fermé (room coupée) → false, pas de blocage.
func TestWaitForPeerJoin_ReturnsFalseOnClosedChannel(t *testing.T) {
	m := &BotManager{}
	events := make(chan roomEnvelope)
	close(events)
	if m.waitForPeerJoin(context.Background(), events) {
		t.Fatal("canal fermé : attendu false")
	}
}

// Contexte annulé → false immédiat (pas d'attente du timeout de fallback).
func TestWaitForPeerJoin_ReturnsFalseOnCtxCancel(t *testing.T) {
	m := &BotManager{}
	events := make(chan roomEnvelope) // jamais alimenté
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	done := make(chan bool, 1)
	go func() { done <- m.waitForPeerJoin(ctx, events) }()
	select {
	case got := <-done:
		if got {
			t.Fatal("ctx annulé : attendu false")
		}
	case <-time.After(time.Second):
		t.Fatal("waitForPeerJoin n'a pas réagi à l'annulation du contexte")
	}
}
