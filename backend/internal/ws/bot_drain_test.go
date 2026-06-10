package ws

import "testing"

// Un Left bufferisé derrière la rafale doit être détecté AVANT de payer un
// appel Claude : le user est parti, le bot doit sortir (sinon il répondrait
// dans une room morte en gardant son slot activeBots).
func TestDrainPending_DetectsBufferedLeft(t *testing.T) {
	events := make(chan roomEnvelope, 4)
	events <- roomEnvelope{Kind: roomKindMsg, Body: "m2"}
	events <- roomEnvelope{Kind: roomKindLeft}

	_, left := drainPending(events, "m1")
	if !left {
		t.Fatal("Left bufferisé : attendu left=true")
	}
}

// Une rafale de messages est coalescée dans l'ordre d'arrivée, message
// courant en tête.
func TestDrainPending_CoalescesBurstInOrder(t *testing.T) {
	events := make(chan roomEnvelope, 4)
	events <- roomEnvelope{Kind: roomKindMsg, Body: "m2"}
	events <- roomEnvelope{Kind: roomKindMsg, Body: "m3"}

	bodies, left := drainPending(events, "m1")
	if left {
		t.Fatal("pas de Left : attendu left=false")
	}
	want := []string{"m1", "m2", "m3"}
	if len(bodies) != len(want) {
		t.Fatalf("bodies = %v, attendu %v", bodies, want)
	}
	for i := range want {
		if bodies[i] != want[i] {
			t.Fatalf("bodies[%d] = %q, attendu %q", i, bodies[i], want[i])
		}
	}
}

// Buffer vide : seul le message courant, pas de Left, et surtout pas de
// blocage (drain non bloquant).
func TestDrainPending_EmptyBuffer(t *testing.T) {
	events := make(chan roomEnvelope, 4)

	bodies, left := drainPending(events, "m1")
	if left {
		t.Fatal("buffer vide : attendu left=false")
	}
	if len(bodies) != 1 || bodies[0] != "m1" {
		t.Fatalf("bodies = %v, attendu [m1]", bodies)
	}
}

// Canal fermé (room coupée) = équivalent d'un Left.
func TestDrainPending_ClosedChannelIsLeft(t *testing.T) {
	events := make(chan roomEnvelope)
	close(events)

	_, left := drainPending(events, "m1")
	if !left {
		t.Fatal("canal fermé : attendu left=true")
	}
}

// Les typing/join bufferisés sont ignorés sans polluer la rafale.
func TestDrainPending_IgnoresTypingAndJoin(t *testing.T) {
	events := make(chan roomEnvelope, 4)
	events <- roomEnvelope{Kind: roomKindTyping}
	events <- roomEnvelope{Kind: roomKindJoin}
	events <- roomEnvelope{Kind: roomKindMsg, Body: "m2"}

	bodies, left := drainPending(events, "m1")
	if left {
		t.Fatal("pas de Left : attendu left=false")
	}
	if len(bodies) != 2 || bodies[0] != "m1" || bodies[1] != "m2" {
		t.Fatalf("bodies = %v, attendu [m1 m2]", bodies)
	}
}
