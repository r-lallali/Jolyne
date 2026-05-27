package friends_test

import (
	"strconv"
	"strings"
	"testing"

	"github.com/ralys/jolyne/backend/internal/friends"
)

func TestUserInboxChannel_PrefixAndID(t *testing.T) {
	got := friends.UserInboxChannel(42)
	if !strings.HasPrefix(got, friends.UserInboxChanPrefix) {
		t.Fatalf("préfixe manquant: %q", got)
	}
	suffix := strings.TrimPrefix(got, friends.UserInboxChanPrefix)
	if suffix != "42" {
		t.Fatalf("suffixe: %q (want 42)", suffix)
	}
}

func TestUserInboxChannel_DistinctPerUser(t *testing.T) {
	if friends.UserInboxChannel(1) == friends.UserInboxChannel(2) {
		t.Fatal("deux user IDs distincts doivent donner des channels distincts")
	}
}

func TestUserInboxChannel_NegativeID(t *testing.T) {
	// Pas vraiment un cas valide, mais on vérifie qu'on ne plante pas.
	got := friends.UserInboxChannel(-1)
	if got == "" {
		t.Fatal("channel vide pour ID négatif")
	}
	if _, err := strconv.ParseInt(strings.TrimPrefix(got, friends.UserInboxChanPrefix), 10, 64); err != nil {
		t.Fatalf("suffixe pas un int: %q", got)
	}
}

func TestUserInboxKindFriendsChanged_NonEmpty(t *testing.T) {
	if friends.UserInboxKindFriendsChanged == "" {
		t.Fatal("kind doit être non vide")
	}
}
