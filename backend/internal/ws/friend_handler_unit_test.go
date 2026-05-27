package ws

import (
	"strings"
	"testing"
	"time"

	"github.com/ralys/jolyne/backend/internal/friends"
)

func TestParseFriendIDFromPath(t *testing.T) {
	cases := []struct {
		path string
		want int64
		ok   bool
	}{
		{"/ws/friend/42", 42, true},
		{"/ws/friend/1", 1, true},
		{"/ws/friend/9999999999", 9999999999, true},
		{"/ws/friend/42/extra", 42, true},
		{"/ws/friend/", 0, false},
		{"/ws/friend/notnum", 0, false},
		{"/other/path", 0, false},
		{"", 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			got, err := parseFriendIDFromPath(tc.path)
			if tc.ok {
				if err != nil {
					t.Fatalf("err: %v", err)
				}
				if got != tc.want {
					t.Fatalf("got %d, want %d", got, tc.want)
				}
			} else {
				if err == nil {
					t.Fatalf("attendu erreur pour %q", tc.path)
				}
			}
		})
	}
}

func TestFriendChannel_Format(t *testing.T) {
	got := friendChannel(123)
	if !strings.HasPrefix(got, friendChanPrefix) {
		t.Fatalf("préfixe manquant: %q", got)
	}
	suffix := strings.TrimPrefix(got, friendChanPrefix)
	if suffix != "123" {
		t.Fatalf("suffixe: %q", suffix)
	}
}

func TestFriendChannel_DistinctPerID(t *testing.T) {
	if friendChannel(1) == friendChannel(2) {
		t.Fatal("IDs distincts → channels distincts")
	}
}

func TestParseFriendChannel_Roundtrip(t *testing.T) {
	for _, id := range []int64{1, 42, 9_999_999_999} {
		ch := friendChannel(id)
		got, ok := parseFriendChannel(ch)
		if !ok {
			t.Fatalf("parse %q: !ok", ch)
		}
		if got != id {
			t.Fatalf("roundtrip: got %d, want %d", got, id)
		}
	}
}

func TestParseFriendChannel_RejectsGarbage(t *testing.T) {
	cases := []string{
		"",
		"friend:",
		"friend:abc",
		"otherprefix:42",
		"42",
	}
	for _, c := range cases {
		t.Run(c, func(t *testing.T) {
			if _, ok := parseFriendChannel(c); ok {
				t.Fatalf("%q ne doit pas parser", c)
			}
		})
	}
}

func TestToDTO_OmitsBodyOnDelete(t *testing.T) {
	// Invariant CLAUDE.md règle d'or #1 : un message supprimé ne doit pas
	// laisser fuiter son ancien contenu via le DTO WS.
	now := time.Now().UTC()
	deletedAt := now.Add(-time.Minute)
	m := friends.Message{
		ID:        1,
		SenderID:  1,
		Body:      "secret",
		SentAt:    now.Add(-time.Hour),
		DeletedAt: &deletedAt,
	}
	dto := toDTO(m)
	if dto.Body != "" {
		t.Fatalf("body d'un msg supprimé doit être vide, got %q", dto.Body)
	}
	if dto.DeletedAt == "" {
		t.Fatal("DeletedAt doit être sérialisé")
	}
}

func TestToDTO_KeepsEditedTimestamp(t *testing.T) {
	now := time.Now().UTC()
	editedAt := now.Add(-30 * time.Second)
	m := friends.Message{
		ID:       2,
		SenderID: 1,
		Body:     "édité",
		SentAt:   now.Add(-time.Minute),
		EditedAt: &editedAt,
	}
	dto := toDTO(m)
	if dto.Body != "édité" {
		t.Fatalf("body: %q", dto.Body)
	}
	if dto.EditedAt == "" {
		t.Fatal("EditedAt doit être sérialisé")
	}
	if dto.DeletedAt != "" {
		t.Fatalf("DeletedAt doit être vide, got %q", dto.DeletedAt)
	}
}

func TestToDTO_NormalMessage(t *testing.T) {
	now := time.Now().UTC()
	m := friends.Message{
		ID:       3,
		SenderID: 7,
		Body:     "hello",
		SentAt:   now,
	}
	dto := toDTO(m)
	if dto.Body != "hello" || dto.SenderID != 7 || dto.ID != 3 {
		t.Fatalf("dto: %+v", dto)
	}
	if dto.EditedAt != "" || dto.DeletedAt != "" {
		t.Fatalf("timestamps optionnels non vides: %+v", dto)
	}
}
