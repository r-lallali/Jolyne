//go:build integration

package translate_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/translate"
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

// TestHandler_CacheHitSkipsUpstream : deux requêtes identiques → un seul
// appel LibreTranslate, réponses identiques.
func TestHandler_CacheHitSkipsUpstream(t *testing.T) {
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		_, _ = w.Write([]byte(`{"translatedText":"bonjour"}`))
	}))
	defer srv.Close()
	h := &translate.Handler{
		Client: translate.NewClient(srv.URL, ""),
		RDB:    newRedis(t),
	}
	post := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/translate",
			strings.NewReader(`{"text":"hello","source":"en","target":"fr"}`))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	first := post()
	second := post()
	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("status: %d / %d", first.Code, second.Code)
	}
	if calls != 1 {
		t.Fatalf("upstream devrait être appelé une seule fois, eu %d", calls)
	}
	if !strings.Contains(second.Body.String(), "bonjour") {
		t.Fatalf("body 2e requête: %s", second.Body.String())
	}
}

// TestHandler_CacheKeyIncludesLangs : même texte mais cible différente →
// pas de collision de cache.
func TestHandler_CacheKeyIncludesLangs(t *testing.T) {
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		_, _ = w.Write([]byte(`{"translatedText":"x"}`))
	}))
	defer srv.Close()
	h := &translate.Handler{
		Client: translate.NewClient(srv.URL, ""),
		RDB:    newRedis(t),
	}
	for _, target := range []string{"fr", "es"} {
		req := httptest.NewRequest(http.MethodPost, "/api/translate",
			strings.NewReader(`{"text":"hello","source":"en","target":"`+target+`"}`))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status (%s): %d", target, rec.Code)
		}
	}
	if calls != 2 {
		t.Fatalf("cibles différentes = 2 appels upstream, eu %d", calls)
	}
}
