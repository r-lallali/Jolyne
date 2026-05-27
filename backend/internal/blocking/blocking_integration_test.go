//go:build integration

package blocking_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/blocking"
)

func newRedis(t *testing.T) *redis.Client {
	t.Helper()
	addr := os.Getenv("TEST_REDIS_ADDR")
	if addr == "" {
		addr = "127.0.0.1:6379"
	}
	rdb := redis.NewClient(&redis.Options{Addr: addr, DialTimeout: 3 * time.Second})
	ctx := context.Background()
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skipf("redis indisponible (%s): %v", addr, err)
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

func TestAddAndIsBlocked(t *testing.T) {
	rdb := newRedis(t)
	s := blocking.New(rdb)
	ctx := context.Background()

	if err := s.Add(ctx, "alice-fp", "bob-fp"); err != nil {
		t.Fatalf("add: %v", err)
	}
	blocked, err := s.IsBlocked(ctx, "alice-fp", "bob-fp")
	if err != nil {
		t.Fatalf("isblocked: %v", err)
	}
	if !blocked {
		t.Fatal("bob doit être bloqué par alice")
	}
}

func TestIsBlocked_Asymmetric(t *testing.T) {
	rdb := newRedis(t)
	s := blocking.New(rdb)
	ctx := context.Background()

	_ = s.Add(ctx, "alice-fp", "bob-fp")
	// alice a bloqué bob — l'inverse ne doit PAS être vrai.
	reverse, err := s.IsBlocked(ctx, "bob-fp", "alice-fp")
	if err != nil {
		t.Fatalf("isblocked: %v", err)
	}
	if reverse {
		t.Fatal("le block est unidirectionnel")
	}
}

func TestAdd_IgnoresEmptyAndSelf(t *testing.T) {
	rdb := newRedis(t)
	s := blocking.New(rdb)
	ctx := context.Background()

	// Tous ces appels sont des no-op.
	cases := []struct{ owner, blocked string }{
		{"", "bob"},
		{"alice", ""},
		{"alice", "alice"}, // se bloquer soi-même
	}
	for _, c := range cases {
		if err := s.Add(ctx, c.owner, c.blocked); err != nil {
			t.Fatalf("add(%q,%q): %v", c.owner, c.blocked, err)
		}
	}
	// Rien ne doit être bloqué.
	for _, c := range cases {
		ok, _ := s.IsBlocked(ctx, c.owner, c.blocked)
		if ok {
			t.Fatalf("(%q,%q) ne doit rien bloquer", c.owner, c.blocked)
		}
	}
}

func TestIsBlocked_EmptyArgs(t *testing.T) {
	rdb := newRedis(t)
	s := blocking.New(rdb)
	ctx := context.Background()
	for _, c := range []struct{ a, b string }{{"", "x"}, {"x", ""}, {"", ""}} {
		ok, err := s.IsBlocked(ctx, c.a, c.b)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if ok {
			t.Fatalf("IsBlocked(%q,%q) doit être false", c.a, c.b)
		}
	}
}

func TestAdd_IsIdempotent(t *testing.T) {
	rdb := newRedis(t)
	s := blocking.New(rdb)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		if err := s.Add(ctx, "owner", "blocked"); err != nil {
			t.Fatalf("add %d: %v", i, err)
		}
	}
	ok, _ := s.IsBlocked(ctx, "owner", "blocked")
	if !ok {
		t.Fatal("encore bloqué après doublons")
	}
}

func TestAdd_RefreshesTTL(t *testing.T) {
	rdb := newRedis(t)
	s := blocking.New(rdb)
	ctx := context.Background()

	_ = s.Add(ctx, "alice", "bob")
	ttl1, err := rdb.TTL(ctx, "blocked:alice").Result()
	if err != nil {
		t.Fatalf("ttl: %v", err)
	}
	if ttl1 <= 0 {
		t.Fatalf("TTL doit être > 0, got %v", ttl1)
	}
	if ttl1 > blocking.TTL+time.Second {
		t.Fatalf("TTL inattendu: %v (max %v)", ttl1, blocking.TTL)
	}
}
