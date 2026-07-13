package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ralys/jolyne/backend/internal/admin"
	"github.com/ralys/jolyne/backend/internal/billing"
	"github.com/ralys/jolyne/backend/internal/friends"
	"github.com/ralys/jolyne/backend/internal/grammar"
	"github.com/ralys/jolyne/backend/internal/learn"
	"github.com/ralys/jolyne/backend/internal/profile"
	"github.com/ralys/jolyne/backend/internal/push"
	"github.com/ralys/jolyne/backend/internal/quota"
	"github.com/ralys/jolyne/backend/internal/translate"
	"github.com/ralys/jolyne/backend/internal/users"
	"github.com/ralys/jolyne/backend/internal/vocab"
	"github.com/ralys/jolyne/backend/internal/ws"
)

// fullServices : toutes les branches actives avec des structs vides — on
// ne teste QUE l'enregistrement des patterns et le matching du mux, jamais
// les handlers eux-mêmes (auth/method rejettent avant de les atteindre).
func fullServices() services {
	return services{
		wsHandler:       &ws.Handler{},
		wsFriendHandler: &ws.FriendHandler{},
		wsInboxHandler:  &ws.InboxHandler{},
		admin:           &admin.Handlers{},
		translate:       &translate.Handler{},
		grammar:         &grammar.Handler{},
		quota:           &quota.Handler{},
		billing:         &billing.Handlers{},
		users:           &users.Handlers{},
		profile:         &profile.Handlers{},
		friends:         &friends.Handlers{},
		vocab:           &vocab.Handlers{},
		learn:           &learn.Handlers{},
		push:            &push.Handlers{},
	}
}

// Un conflit de patterns ServeMux (wildcard vs littéral ambigus) panique à
// l'enregistrement : ce test échoue au boot plutôt qu'en prod.
func TestRoutesRegisterWithoutPanic(t *testing.T) {
	_ = routes(fullServices())
}

// Vérifie que les patterns à wildcard matchent (≠ 404) et que les chemins
// hors schéma tombent en 404. On n'atteint jamais un handler métier : les
// routes auth renvoient 401 (pas de cookie), les mauvaises méthodes 405.
func TestRoutesPatternMatching(t *testing.T) {
	h := routes(fullServices())

	cases := []struct {
		method, path string
		want         int
	}{
		// Wildcards {id} : la route matche puis l'auth rejette (401 ≠ 404).
		{http.MethodDelete, "/api/friends/42", http.StatusUnauthorized},
		{http.MethodGet, "/api/friends/42/messages", http.StatusUnauthorized},
		{http.MethodPost, "/api/friends/42/report", http.StatusUnauthorized},
		{http.MethodPost, "/api/friends/42/streak/restore", http.StatusUnauthorized},
		{http.MethodDelete, "/api/vocab/7", http.StatusUnauthorized},
		{http.MethodPost, "/api/vocab/7/review", http.StatusUnauthorized},
		{http.MethodGet, "/api/vocab/review", http.StatusUnauthorized},
		{http.MethodGet, "/api/learn/courses/ja", http.StatusUnauthorized},
		{http.MethodPost, "/api/learn/courses/ja/placement", http.StatusUnauthorized},
		{http.MethodGet, "/api/learn/lessons/12", http.StatusUnauthorized},
		{http.MethodPost, "/api/learn/lessons/12/complete", http.StatusUnauthorized},
		{http.MethodPost, "/api/learn/hearts/requests/3/grant", http.StatusUnauthorized},
		{http.MethodDelete, "/api/account/photos/2", http.StatusUnauthorized},
		// Hors schéma : segments en trop → 404 du mux, plus de dispatch manuel.
		{http.MethodDelete, "/api/friends/42/x/y", http.StatusNotFound},
		{http.MethodDelete, "/api/vocab/7/review/extra", http.StatusNotFound},
		{http.MethodGet, "/api/learn/lessons/12/complete/x", http.StatusNotFound},
	}
	for _, c := range cases {
		req := httptest.NewRequest(c.method, c.path, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != c.want {
			t.Errorf("%s %s : code %d, attendu %d", c.method, c.path, rec.Code, c.want)
		}
	}
}

// Domaines non configurés : 503 explicite (jamais un 404 muet qui se déguise
// en erreur CORS côté front). Admin et /metrics restent volontairement en 404
// — on ne révèle pas leur existence.
func TestRoutesDisabledDomainsReturn503(t *testing.T) {
	h := routes(services{wsHandler: &ws.Handler{}})

	disabled := []string{
		"/api/auth/login",
		"/api/account",
		"/api/account/verify",
		"/api/friends",
		"/api/friends/42/messages",
		"/api/vocab",
		"/api/vocab/review",
		"/api/learn/state",
		"/api/billing/checkout",
		"/api/notifications/subscribe",
		"/api/translate",
		"/api/grammar",
		"/api/quota",
		"/api/events",
		"/ws/inbox",
		"/ws/friend/42",
	}
	for _, p := range disabled {
		req := httptest.NewRequest(http.MethodPost, p, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusServiceUnavailable {
			t.Errorf("POST %s : code %d, attendu 503", p, rec.Code)
		}
	}

	hidden := []string{"/api/admin/login", "/metrics"}
	for _, p := range hidden {
		req := httptest.NewRequest(http.MethodGet, p, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Errorf("GET %s : code %d, attendu 404 (existence masquée)", p, rec.Code)
		}
	}
}
