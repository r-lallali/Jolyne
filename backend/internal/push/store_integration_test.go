//go:build integration

package push_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ralys/jolyne/backend/internal/db"
	"github.com/ralys/jolyne/backend/internal/push"
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
			`DELETE FROM push_subscriptions WHERE endpoint LIKE 'pushtest://%'`)
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM users WHERE email LIKE '%@pushtest.local'`)
		pool.Close()
	})
	return pool
}

func makeUser(t *testing.T, pool *pgxpool.Pool) int64 {
	t.Helper()
	var id int64
	email := fmt.Sprintf("u-%d@pushtest.local", time.Now().UnixNano())
	err := pool.QueryRow(context.Background(),
		`INSERT INTO users (email) VALUES ($1) RETURNING id`, email,
	).Scan(&id)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	return id
}

func TestUpsert_InsertsThenUpdates(t *testing.T) {
	pool := newPool(t)
	s := push.NewStore(pool)
	uid := makeUser(t, pool)
	endpoint := fmt.Sprintf("pushtest://e-%d", time.Now().UnixNano())

	if err := s.Upsert(context.Background(), uid, push.Subscription{
		Endpoint: endpoint, P256dh: "k1", Auth: "a1", UserAgent: "ua-1",
	}); err != nil {
		t.Fatalf("upsert 1: %v", err)
	}
	if err := s.Upsert(context.Background(), uid, push.Subscription{
		Endpoint: endpoint, P256dh: "k2", Auth: "a2", UserAgent: "ua-2",
	}); err != nil {
		t.Fatalf("upsert 2: %v", err)
	}
	subs, err := s.ListForUser(context.Background(), uid)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(subs) != 1 {
		t.Fatalf("upsert ne doit pas doublonner, got %d entries", len(subs))
	}
	if subs[0].P256dh != "k2" || subs[0].Auth != "a2" {
		t.Fatalf("keys non mises à jour: %+v", subs[0])
	}
}

func TestUpsert_DifferentEndpoints(t *testing.T) {
	pool := newPool(t)
	s := push.NewStore(pool)
	uid := makeUser(t, pool)
	for i := 0; i < 3; i++ {
		endpoint := fmt.Sprintf("pushtest://e-%d-%d", time.Now().UnixNano(), i)
		if err := s.Upsert(context.Background(), uid, push.Subscription{
			Endpoint: endpoint, P256dh: "k", Auth: "a",
		}); err != nil {
			t.Fatalf("upsert: %v", err)
		}
	}
	subs, _ := s.ListForUser(context.Background(), uid)
	if len(subs) != 3 {
		t.Fatalf("3 subs attendus, got %d", len(subs))
	}
}

func TestDeleteByEndpoint(t *testing.T) {
	pool := newPool(t)
	s := push.NewStore(pool)
	uid := makeUser(t, pool)
	endpoint := fmt.Sprintf("pushtest://e-del-%d", time.Now().UnixNano())
	_ = s.Upsert(context.Background(), uid, push.Subscription{
		Endpoint: endpoint, P256dh: "k", Auth: "a",
	})

	if err := s.DeleteByEndpoint(context.Background(), endpoint); err != nil {
		t.Fatalf("delete: %v", err)
	}
	subs, _ := s.ListForUser(context.Background(), uid)
	if len(subs) != 0 {
		t.Fatalf("sub doit être supprimée, got %d", len(subs))
	}
}

func TestListForUser_Empty(t *testing.T) {
	pool := newPool(t)
	s := push.NewStore(pool)
	uid := makeUser(t, pool)
	subs, err := s.ListForUser(context.Background(), uid)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(subs) != 0 {
		t.Fatalf("aucun sub attendu, got %d", len(subs))
	}
}
