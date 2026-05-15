//go:build integration

package quota_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/quota"
)

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

func TestQuota_IncrementsAndSetsTTL(t *testing.T) {
	rdb := newRedis(t)
	e := quota.NewEngine(rdb, time.UTC)
	ctx := context.Background()

	used, err := e.CheckAndIncrementNext(ctx, "user1", 5)
	if err != nil {
		t.Fatalf("first incr: %v", err)
	}
	if used != 1 {
		t.Fatalf("attendu 1, got %d", used)
	}
	used, err = e.CheckAndIncrementNext(ctx, "user1", 5)
	if err != nil {
		t.Fatalf("second incr: %v", err)
	}
	if used != 2 {
		t.Fatalf("attendu 2, got %d", used)
	}
	// TTL doit être posé et raisonnable (<= 24h)
	ttl, err := rdb.TTL(ctx, "quota:next:user1").Result()
	if err != nil {
		t.Fatalf("ttl: %v", err)
	}
	if ttl <= 0 || ttl > 24*time.Hour+time.Second {
		t.Fatalf("ttl hors borne (0, 24h], got %v", ttl)
	}
}

func TestQuota_ExceedsReturnsErrQuotaExceeded(t *testing.T) {
	rdb := newRedis(t)
	e := quota.NewEngine(rdb, time.UTC)
	ctx := context.Background()

	for i := 1; i <= 5; i++ {
		used, err := e.CheckAndIncrementNext(ctx, "u", 5)
		if err != nil {
			t.Fatalf("iter %d: %v", i, err)
		}
		if used != int64(i) {
			t.Fatalf("iter %d: attendu %d, got %d", i, i, used)
		}
	}
	// 6e appel dépasse la limite
	used, err := e.CheckAndIncrementNext(ctx, "u", 5)
	if !errors.Is(err, quota.ErrQuotaExceeded) {
		t.Fatalf("attendu ErrQuotaExceeded, got %v", err)
	}
	if used != 6 {
		t.Fatalf("used devrait toujours s'incrémenter, attendu 6 got %d", used)
	}
}

func TestQuota_IndependentPerID(t *testing.T) {
	rdb := newRedis(t)
	e := quota.NewEngine(rdb, time.UTC)
	ctx := context.Background()

	e.CheckAndIncrementNext(ctx, "alice", 5)
	e.CheckAndIncrementNext(ctx, "alice", 5)
	used, _ := e.CheckAndIncrementNext(ctx, "bob", 5)
	if used != 1 {
		t.Fatalf("compteur de bob devrait être 1, got %d", used)
	}
}

func TestQuota_NoLimitWhenMaxZero(t *testing.T) {
	rdb := newRedis(t)
	e := quota.NewEngine(rdb, time.UTC)
	ctx := context.Background()

	for i := 0; i < 100; i++ {
		if _, err := e.CheckAndIncrementNext(ctx, "premium", 0); err != nil {
			t.Fatalf("iter %d: %v", i, err)
		}
	}
}

func TestQuota_TTLNotResetOnSubsequentIncrement(t *testing.T) {
	rdb := newRedis(t)
	e := quota.NewEngine(rdb, time.UTC)
	ctx := context.Background()

	e.CheckAndIncrementNext(ctx, "u", 10)
	ttl1, _ := rdb.TTL(ctx, "quota:next:u").Result()
	time.Sleep(50 * time.Millisecond)
	e.CheckAndIncrementNext(ctx, "u", 10)
	ttl2, _ := rdb.TTL(ctx, "quota:next:u").Result()
	// ttl2 doit être ≤ ttl1 (ExpireNX ne reset pas)
	if ttl2 > ttl1 {
		t.Fatalf("TTL ne devrait pas être prolongé : ttl1=%v ttl2=%v", ttl1, ttl2)
	}
}
