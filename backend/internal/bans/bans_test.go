package bans_test

import (
	"context"
	"strings"
	"testing"

	"github.com/ralys/jolyne/backend/internal/bans"
)

// Les validations d'entrée d'IssueBan court-circuitent avant tout accès
// au pool — on peut donc construire un Service à pool nil et tester ces
// chemins. Les cas qui passent la validation sont couverts par les tests
// d'intégration (build tag `integration`).

func TestIssueBan_RejectsAllEmptyAxes(t *testing.T) {
	s := bans.NewService(nil)
	_, err := s.IssueBan(context.Background(), bans.Issue{BannedBy: "admin@x"}, "")
	if err == nil {
		t.Fatal("ban sans axe doit échouer")
	}
	if !strings.Contains(err.Error(), "axe") {
		t.Fatalf("err devrait mentionner 'axe': %v", err)
	}
}

func TestIssueBan_RejectsMissingBannedBy(t *testing.T) {
	s := bans.NewService(nil)
	_, err := s.IssueBan(context.Background(), bans.Issue{
		IPHash: "h",
	}, "")
	if err == nil {
		t.Fatal("ban sans BannedBy doit échouer")
	}
	if !strings.Contains(err.Error(), "BannedBy") {
		t.Fatalf("err devrait mentionner 'BannedBy': %v", err)
	}
}

func TestTargetType_Constants(t *testing.T) {
	// Les enum strings sont persistés en DB — sentinelles pour qu'on ne
	// les renomme pas par mégarde.
	if bans.TargetIP != "ip" {
		t.Fatalf("TargetIP = %q", bans.TargetIP)
	}
	if bans.TargetFingerprint != "fingerprint" {
		t.Fatalf("TargetFingerprint = %q", bans.TargetFingerprint)
	}
	if bans.TargetUser != "user" {
		t.Fatalf("TargetUser = %q", bans.TargetUser)
	}
}
