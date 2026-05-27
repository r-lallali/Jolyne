//go:build integration

package bans_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ralys/jolyne/backend/internal/bans"
	"github.com/ralys/jolyne/backend/internal/db"
)

func dsn(t *testing.T) string {
	t.Helper()
	v := os.Getenv("TEST_POSTGRES_DSN")
	if v == "" {
		v = "postgres://jolyne:jolyne@127.0.0.1:5432/jolyne?sslmode=disable"
	}
	return v
}

func newPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	d := dsn(t)
	pool, err := db.New(context.Background(), d)
	if err != nil {
		t.Skipf("postgres indisponible: %v", err)
	}
	if err := db.RunMigrations(d); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM bans WHERE banned_by LIKE '%@banstest.local'`)
		pool.Close()
	})
	return pool
}

func TestIssueBan_InsertsOnePerAxis(t *testing.T) {
	pool := newPool(t)
	s := bans.NewService(pool)
	ip := fmt.Sprintf("ip-%d", time.Now().UnixNano())
	fp := fmt.Sprintf("fp-%d", time.Now().UnixNano())
	ids, err := s.IssueBan(context.Background(), bans.Issue{
		IPHash:      ip,
		Fingerprint: fp,
		Reason:      "spam",
		BannedBy:    "admin@banstest.local",
		Duration:    time.Hour,
	}, "audit-ip")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if len(ids) != 2 {
		t.Fatalf("2 IDs attendus (ip + fp), got %d", len(ids))
	}
}

func TestCheckActive_FindsBan(t *testing.T) {
	pool := newPool(t)
	s := bans.NewService(pool)
	ip := fmt.Sprintf("ip-active-%d", time.Now().UnixNano())
	_, err := s.IssueBan(context.Background(), bans.Issue{
		IPHash:   ip,
		Reason:   "test",
		BannedBy: "admin@banstest.local",
		Duration: time.Hour,
	}, "")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	b, err := s.CheckActive(context.Background(), ip, "")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if b == nil {
		t.Fatal("ban actif attendu")
	}
	if b.TargetType != bans.TargetIP || b.TargetValue != ip {
		t.Fatalf("target: %v / %q", b.TargetType, b.TargetValue)
	}
}

func TestCheckActive_Permanent(t *testing.T) {
	pool := newPool(t)
	s := bans.NewService(pool)
	fp := fmt.Sprintf("fp-perm-%d", time.Now().UnixNano())
	_, err := s.IssueBan(context.Background(), bans.Issue{
		Fingerprint: fp,
		BannedBy:    "admin@banstest.local",
		// Duration = 0 → permanent.
	}, "")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	b, _ := s.CheckActive(context.Background(), "", fp)
	if b == nil {
		t.Fatal("ban permanent attendu")
	}
	if b.ExpiresAt != nil {
		t.Fatalf("permanent doit avoir ExpiresAt = nil, got %v", b.ExpiresAt)
	}
}

func TestCheckActive_NoBan(t *testing.T) {
	pool := newPool(t)
	s := bans.NewService(pool)
	b, err := s.CheckActive(context.Background(), "no-such-ip", "no-such-fp")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if b != nil {
		t.Fatalf("aucun ban attendu, got %+v", b)
	}
}

func TestCheckActive_EmptyArgs(t *testing.T) {
	pool := newPool(t)
	s := bans.NewService(pool)
	b, err := s.CheckActive(context.Background(), "", "")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if b != nil {
		t.Fatal("args vides → pas de check")
	}
}

func TestLift_ExpiresBan(t *testing.T) {
	pool := newPool(t)
	s := bans.NewService(pool)
	ip := fmt.Sprintf("ip-lift-%d", time.Now().UnixNano())
	ids, err := s.IssueBan(context.Background(), bans.Issue{
		IPHash:   ip,
		BannedBy: "admin@banstest.local",
		Duration: time.Hour,
	}, "")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if err := s.Lift(context.Background(), ids[0], "admin@banstest.local", ""); err != nil {
		t.Fatalf("lift: %v", err)
	}
	b, _ := s.CheckActive(context.Background(), ip, "")
	if b != nil {
		t.Fatal("ban devrait être levé")
	}
}
