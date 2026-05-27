package session_test

import (
	"testing"

	"github.com/ralys/jolyne/backend/internal/session"
)

func TestNew_FillsFields(t *testing.T) {
	s := session.New("alice", "fr", "en", "fp-123", "iphash-xyz", session.PlanFree)
	if s.Pseudo != "alice" {
		t.Fatalf("pseudo: %q", s.Pseudo)
	}
	if s.Speaks != "fr" || s.Wants != "en" {
		t.Fatalf("langs: %s/%s", s.Speaks, s.Wants)
	}
	if s.Fingerprint != "fp-123" {
		t.Fatalf("fp: %q", s.Fingerprint)
	}
	if s.IPHash != "iphash-xyz" {
		t.Fatalf("iphash: %q", s.IPHash)
	}
	if s.Plan != session.PlanFree {
		t.Fatalf("plan: %v", s.Plan)
	}
	if s.UserID != 0 {
		t.Fatalf("UserID default doit être 0, got %d", s.UserID)
	}
	if s.ID == "" {
		t.Fatal("ID doit être généré")
	}
}

func TestNew_GeneratesUniqueIDs(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		s := session.New("p", "fr", "en", "f", "i", session.PlanFree)
		if s.ID == "" {
			t.Fatal("ID vide")
		}
		if seen[s.ID] {
			t.Fatalf("ID dupliqué: %s", s.ID)
		}
		seen[s.ID] = true
	}
}

func TestPlanConstants(t *testing.T) {
	if session.PlanFree == session.PlanPremium {
		t.Fatal("PlanFree et PlanPremium ne doivent pas être égaux")
	}
}
