//go:build integration

package db_test

import (
	"context"
	"os"
	"testing"
	"time"

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

func TestNew_ConnectsAndPings(t *testing.T) {
	pool, err := db.New(context.Background(), dsn(t))
	if err != nil {
		t.Skipf("postgres indisponible : %v", err)
	}
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
}

func TestRunMigrations_AppliesSchema(t *testing.T) {
	d := dsn(t)
	if err := db.RunMigrations(d); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	// Idempotent : 2e run ne doit pas planter
	if err := db.RunMigrations(d); err != nil {
		t.Fatalf("migrate (2e run): %v", err)
	}

	pool, err := db.New(context.Background(), d)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	// Vérifie que les 3 tables existent
	for _, table := range []string{"reports", "bans", "audit_log"} {
		var count int
		err := pool.QueryRow(
			context.Background(),
			"SELECT count(*) FROM information_schema.tables WHERE table_name = $1",
			table,
		).Scan(&count)
		if err != nil {
			t.Fatalf("check %s: %v", table, err)
		}
		if count != 1 {
			t.Fatalf("table %q manquante", table)
		}
	}
}
