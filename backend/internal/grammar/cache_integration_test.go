//go:build integration

package grammar_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/grammar"
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

// TestHandler_CacheHitSkipsUpstream : deux vérifications identiques → un
// seul appel LanguageTool, réponses identiques.
func TestHandler_CacheHitSkipsUpstream(t *testing.T) {
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		_, _ = w.Write([]byte(`{"matches":[{"message":"typo","offset":0,"length":2,"replacements":[{"value":"hi"}]}]}`))
	}))
	defer srv.Close()
	h := &grammar.Handler{
		Client: grammar.NewClient(srv.URL),
		RDB:    newRedis(t),
	}
	post := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/grammar",
			strings.NewReader(`{"text":"hj there","lang":"en"}`))
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
	if !strings.Contains(second.Body.String(), "typo") {
		t.Fatalf("body 2e requête: %s", second.Body.String())
	}
}

// TestHandler_CachesEmptyMatches : un texte sans faute est aussi caché —
// c'est le cas le plus fréquent, il ne doit pas retaper LanguageTool.
func TestHandler_CachesEmptyMatches(t *testing.T) {
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		_, _ = w.Write([]byte(`{"matches":[]}`))
	}))
	defer srv.Close()
	h := &grammar.Handler{
		Client: grammar.NewClient(srv.URL),
		RDB:    newRedis(t),
	}
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/grammar",
			strings.NewReader(`{"text":"perfect sentence","lang":"en"}`))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status (i=%d): %d", i, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), `"matches":[]`) {
			t.Fatalf("body (i=%d): %s", i, rec.Body.String())
		}
	}
	if calls != 1 {
		t.Fatalf("texte sans faute doit être caché, eu %d appels", calls)
	}
}

// TestHandler_CacheKeyIncludesLang : même texte mais langue différente →
// pas de collision de cache.
func TestHandler_CacheKeyIncludesLang(t *testing.T) {
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		_, _ = w.Write([]byte(`{"matches":[]}`))
	}))
	defer srv.Close()
	h := &grammar.Handler{
		Client: grammar.NewClient(srv.URL),
		RDB:    newRedis(t),
	}
	for _, lang := range []string{"fr", "en"} {
		req := httptest.NewRequest(http.MethodPost, "/api/grammar",
			strings.NewReader(`{"text":"pain","lang":"`+lang+`"}`))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status (%s): %d", lang, rec.Code)
		}
	}
	if calls != 2 {
		t.Fatalf("langues différentes = 2 appels upstream, eu %d", calls)
	}
}

// TestHandler_UpstreamErrorNotCached : un échec LanguageTool ne doit pas
// polluer le cache — la requête suivante retape l'upstream.
func TestHandler_UpstreamErrorNotCached(t *testing.T) {
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls <= 2 { // 1er appel + son retry transitoire
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		_, _ = w.Write([]byte(`{"matches":[]}`))
	}))
	defer srv.Close()
	h := &grammar.Handler{
		Client: grammar.NewClient(srv.URL),
		RDB:    newRedis(t),
	}
	post := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/grammar",
			strings.NewReader(`{"text":"hello","lang":"en"}`))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	if rec := post(); rec.Code != http.StatusBadGateway {
		t.Fatalf("1re requête doit échouer en 502, eu %d", rec.Code)
	}
	if rec := post(); rec.Code != http.StatusOK {
		t.Fatalf("2e requête doit réussir, eu %d", rec.Code)
	}
}
