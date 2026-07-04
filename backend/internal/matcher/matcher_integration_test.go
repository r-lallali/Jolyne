//go:build integration

package matcher_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/matcher"
)

// newRedis ouvre une connexion vers le Redis local et FlushDB avant chaque
// test. Skippe si Redis n'est pas joignable (dev sans `docker compose -f
// infra/docker-compose.dev.yml up redis`).
func newRedis(t *testing.T) *redis.Client {
	t.Helper()
	addr := os.Getenv("TEST_REDIS_ADDR")
	if addr == "" {
		addr = "127.0.0.1:6379"
	}
	rdb := redis.NewClient(&redis.Options{
		Addr:        addr,
		DialTimeout: 3 * time.Second,
	})
	ctx := context.Background()
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skipf("redis indisponible (%s) — lance `docker compose -f infra/docker-compose.dev.yml up -d redis`: %v", addr, err)
	}
	if err := rdb.FlushDB(ctx).Err(); err != nil {
		t.Fatalf("flushdb: %v", err)
	}
	t.Cleanup(func() {
		_ = rdb.FlushDB(ctx)
		_ = rdb.Close()
	})
	return rdb
}

func TestTryMatch_EmptyQueueAddsSelf(t *testing.T) {
	rdb := newRedis(t)
	m := matcher.New(rdb)
	out, err := m.TryMatch(context.Background(), matcher.FR, matcher.EN, "alice", "", 100)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if out.Matched {
		t.Fatalf("expected no match, got %+v", out)
	}
	// alice doit être dans queue:speaks=fr,wants=en (sorted set)
	got, err := rdb.ZRange(context.Background(), "queue:speaks=fr,wants=en", 0, -1).Result()
	if err != nil {
		t.Fatalf("zrange: %v", err)
	}
	if len(got) != 1 || got[0] != "alice" {
		t.Fatalf("queue should contain [alice], got %v", got)
	}
}

func TestTryMatch_PicksWaitingPeer(t *testing.T) {
	rdb := newRedis(t)
	m := matcher.New(rdb)
	ctx := context.Background()

	// alice se met en attente (FR→EN)
	if out, _ := m.TryMatch(ctx, matcher.FR, matcher.EN, "alice", "", 100); out.Matched {
		t.Fatal("alice ne devrait pas matcher (queue vide)")
	}
	// bob arrive avec la paire miroir (EN→FR) → doit matcher alice
	out, err := m.TryMatch(ctx, matcher.EN, matcher.FR, "bob", "", 200)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !out.Matched || out.PeerID != "alice" {
		t.Fatalf("attendu match avec alice, got %+v", out)
	}
	// queue d'alice doit être vide
	left, _ := rdb.ZCard(ctx, "queue:speaks=fr,wants=en").Result()
	if left != 0 {
		t.Fatalf("alice's queue should be empty, has %d", left)
	}
}

func TestTryMatch_AvoidLastPeer(t *testing.T) {
	rdb := newRedis(t)
	m := matcher.New(rdb)
	ctx := context.Background()

	// alice se met en attente
	m.TryMatch(ctx, matcher.FR, matcher.EN, "alice", "", 100)
	// bob arrive avec avoid=alice (vient de la quitter) → ne doit PAS matcher
	out, err := m.TryMatch(ctx, matcher.EN, matcher.FR, "bob", "alice", 200)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if out.Matched {
		t.Fatalf("bob ne devrait pas re-matcher alice, got %+v", out)
	}
	// alice doit être restée matchable pour les autres
	out, _ = m.TryMatch(ctx, matcher.EN, matcher.FR, "charlie", "", 300)
	if !out.Matched || out.PeerID != "alice" {
		t.Fatalf("charlie devrait matcher alice, got %+v", out)
	}
}

// Le peer au score le plus BAS est matché en premier (priorité) — pas l'ordre
// d'arrivée FIFO. dave (score 50) passe devant carol (score 100) bien qu'inscrit
// après.
func TestTryMatch_PicksLowestScoreFirst(t *testing.T) {
	rdb := newRedis(t)
	m := matcher.New(rdb)
	ctx := context.Background()

	// carol s'inscrit avec un score élevé (peer standard).
	m.TryMatch(ctx, matcher.FR, matcher.EN, "carol", "", 100)
	// dave s'inscrit APRÈS mais avec un score plus bas (ex: Premium/authentifié).
	m.TryMatch(ctx, matcher.FR, matcher.EN, "dave", "", 50)

	// eve cherche un peer (EN→FR) → doit tomber sur dave (score le plus bas).
	out, err := m.TryMatch(ctx, matcher.EN, matcher.FR, "eve", "", 200)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !out.Matched || out.PeerID != "dave" {
		t.Fatalf("attendu match prioritaire avec dave, got %+v", out)
	}
	// carol reste en file.
	left, _ := rdb.ZCard(ctx, "queue:speaks=fr,wants=en").Result()
	if left != 1 {
		t.Fatalf("carol devrait rester en file, ZCard=%d", left)
	}
}

func TestTryMatch_InvalidPair(t *testing.T) {
	rdb := newRedis(t)
	m := matcher.New(rdb)
	_, err := m.TryMatch(context.Background(), matcher.FR, matcher.FR, "alice", "", 100)
	if !errors.Is(err, matcher.ErrSameLang) {
		t.Fatalf("attendu ErrSameLang, got %v", err)
	}
}

func TestCancel_RemovesFromQueue(t *testing.T) {
	rdb := newRedis(t)
	m := matcher.New(rdb)
	ctx := context.Background()

	m.TryMatch(ctx, matcher.FR, matcher.EN, "alice", "", 100)
	if err := m.Cancel(ctx, matcher.FR, matcher.EN, "alice"); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	// bob qui essaye de matcher ne doit rien trouver
	out, _ := m.TryMatch(ctx, matcher.EN, matcher.FR, "bob", "", 200)
	if out.Matched {
		t.Fatalf("attendu pas de match après cancel, got %+v", out)
	}
}

func TestCancel_Idempotent(t *testing.T) {
	rdb := newRedis(t)
	m := matcher.New(rdb)
	ctx := context.Background()
	// Cancel sur une queue qui n'a jamais vu cet ID
	if err := m.Cancel(ctx, matcher.FR, matcher.EN, "ghost"); err != nil {
		t.Fatalf("cancel ghost: %v", err)
	}
}
