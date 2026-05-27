//go:build integration

package reports_test

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ralys/jolyne/backend/internal/crypto"
	"github.com/ralys/jolyne/backend/internal/db"
	"github.com/ralys/jolyne/backend/internal/reports"
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
			`DELETE FROM reports WHERE reporter_session LIKE 'reptest-%'`)
		pool.Close()
	})
	return pool
}

func newBox(t *testing.T) *crypto.Box {
	t.Helper()
	k := make([]byte, 32)
	_, _ = rand.Read(k)
	b, err := crypto.NewBox(base64.StdEncoding.EncodeToString(k))
	if err != nil {
		t.Fatalf("box: %v", err)
	}
	return b
}

func TestSave_InsertsAndEncrypts(t *testing.T) {
	pool := newPool(t)
	box := newBox(t)
	s := reports.NewService(pool, box)

	r := reports.Report{
		ReporterSession:     "reptest-sess-1",
		ReporterFingerprint: "reptest-fp-1",
		ReporterIPHash:      "reptest-ip-1",
		ReportedSession:     "reptest-sess-2",
		ReportedFingerprint: "reptest-fp-2",
		ReportedIPHash:      "reptest-ip-2",
		ReportedNick:        "bob",
		Reason:              "harcèlement",
		Messages: []reports.CapturedMessage{
			{From: "bob", Body: "message brut sensible", At: time.Now().UTC().Format(time.RFC3339Nano)},
		},
	}
	id, err := s.Save(context.Background(), r)
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if id <= 0 {
		t.Fatalf("id: %d", id)
	}

	// Vérifie que le contenu en base est CHIFFRÉ (le body ne doit pas
	// apparaître en clair). RGPD : on ne stocke jamais le brut.
	var ciphered []byte
	if err := pool.QueryRow(context.Background(),
		`SELECT captured_messages FROM reports WHERE id = $1`, id,
	).Scan(&ciphered); err != nil {
		t.Fatalf("read row: %v", err)
	}
	if len(ciphered) == 0 {
		t.Fatal("captured_messages vide")
	}
	for _, want := range []string{"message brut sensible", "harcèlement"} {
		if contains(ciphered, want) {
			t.Fatalf("texte clair leaké en DB: %q", want)
		}
	}

	// Le box déchiffre correctement et on retrouve le body en clair.
	plain, err := box.Open(ciphered)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	var payload struct {
		Messages []reports.CapturedMessage `json:"messages"`
	}
	if err := json.Unmarshal(plain, &payload); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(payload.Messages) != 1 || payload.Messages[0].Body != "message brut sensible" {
		t.Fatalf("contenu inattendu: %+v", payload)
	}
}

func TestSave_EmptyReasonStoredAsNull(t *testing.T) {
	pool := newPool(t)
	s := reports.NewService(pool, newBox(t))

	id, err := s.Save(context.Background(), reports.Report{
		ReporterSession: "reptest-sess-nil",
		ReportedNick:    "x",
		Reason:          "",
	})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	var reason *string
	if err := pool.QueryRow(context.Background(),
		`SELECT reason FROM reports WHERE id = $1`, id,
	).Scan(&reason); err != nil {
		t.Fatalf("read: %v", err)
	}
	if reason != nil {
		t.Fatalf("reason vide doit être NULL en DB, got %q", *reason)
	}
}

func contains(haystack []byte, needle string) bool {
	if len(needle) == 0 {
		return false
	}
	nb := []byte(needle)
	for i := 0; i+len(nb) <= len(haystack); i++ {
		if string(haystack[i:i+len(nb)]) == needle {
			return true
		}
	}
	return false
}
