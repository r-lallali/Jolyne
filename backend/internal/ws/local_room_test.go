package ws

import (
	"context"
	"testing"
	"time"
)

// Les deux extrémités sont croisées : ce que A publie arrive chez B (et
// inversement), sans echo de son propre côté.
func TestLocalRoom_CrossDelivery(t *testing.T) {
	a, b := newLocalRoomPair()
	ctx := context.Background()

	if err := a.SendMsg(ctx, "id-1", "hello"); err != nil {
		t.Fatalf("SendMsg: %v", err)
	}
	select {
	case env := <-b.Channel():
		if env.Kind != roomKindMsg || env.Body != "hello" || env.ID != "id-1" {
			t.Fatalf("env = %+v, attendu msg hello/id-1", env)
		}
	default:
		t.Fatal("message A→B non livré")
	}
	select {
	case env := <-a.Channel():
		t.Fatalf("echo inattendu côté A : %+v", env)
	default:
	}

	if err := b.SendTyping(ctx); err != nil {
		t.Fatalf("SendTyping: %v", err)
	}
	select {
	case env := <-a.Channel():
		if env.Kind != roomKindTyping {
			t.Fatalf("env = %+v, attendu typing", env)
		}
	default:
		t.Fatal("typing B→A non livré")
	}
}

// Les messages publiés AVANT que l'autre côté ne lise sont bufferisés — c'est
// la garantie qui manquait à pub/sub (greeting du prof IA jamais perdu).
func TestLocalRoom_BuffersUntilRead(t *testing.T) {
	a, b := newLocalRoomPair()
	ctx := context.Background()

	for i := 0; i < 5; i++ {
		if err := a.SendMsg(ctx, "", "m"); err != nil {
			t.Fatalf("SendMsg: %v", err)
		}
	}
	for i := 0; i < 5; i++ {
		select {
		case <-b.Channel():
		default:
			t.Fatalf("message %d non bufferisé", i)
		}
	}
}

// Buffer plein : on droppe sans bloquer (politique pub/sub) — la boucle WS ne
// doit jamais se figer sur un publish.
func TestLocalRoom_DropsWhenFullWithoutBlocking(t *testing.T) {
	a, _ := newLocalRoomPair()
	ctx := context.Background()

	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < localRoomBuffer+10; i++ {
			_ = a.SendMsg(ctx, "", "m")
		}
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("publish a bloqué sur buffer plein")
	}
}

// SendLeft respecte le contexte : peer plein et vivant → on sort sur le
// timeout du ctx plutôt que de bloquer indéfiniment.
func TestLocalRoom_SendLeftHonorsContext(t *testing.T) {
	a, _ := newLocalRoomPair()
	ctx := context.Background()
	for i := 0; i < localRoomBuffer; i++ {
		_ = a.SendMsg(ctx, "", "m")
	}
	tctx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
	defer cancel()
	if err := a.SendLeft(tctx); err == nil {
		t.Fatal("attendu une erreur de contexte (buffer plein, peer vivant)")
	}
}

// Peer fermé : les publish deviennent des no-ops silencieux (personne à
// livrer), y compris SendLeft — pas de blocage, pas d'erreur.
func TestLocalRoom_PublishAfterPeerClose(t *testing.T) {
	a, b := newLocalRoomPair()
	ctx := context.Background()
	_ = b.Close()
	// Close idempotent.
	_ = b.Close()

	for i := 0; i < localRoomBuffer+10; i++ {
		if err := a.SendMsg(ctx, "", "m"); err != nil {
			t.Fatalf("SendMsg après Close peer: %v", err)
		}
	}
	if err := a.SendLeft(ctx); err != nil {
		t.Fatalf("SendLeft après Close peer: %v", err)
	}
}
