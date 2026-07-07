package ws

import (
	"strings"
	"testing"
)

func TestParseIcebreakers(t *testing.T) {
	t.Run("array wrapped in prose", func(t *testing.T) {
		raw := `Voici : ["Tu as voyagé récemment ?","Quel est ton plat préféré ?"] fin`
		got := parseIcebreakers(raw)
		if len(got) != 2 || got[0] != "Tu as voyagé récemment ?" {
			t.Fatalf("got %+v", got)
		}
	})
	t.Run("dedup, trims, drops empty and too long", func(t *testing.T) {
		long := strings.Repeat("a", icebreakerMaxLen+1)
		raw := `["  Salut, tu fais quoi ?  ","Salut, tu fais quoi ?","","` + long + `"]`
		got := parseIcebreakers(raw)
		if len(got) != 1 || got[0] != "Salut, tu fais quoi ?" {
			t.Fatalf("got %+v", got)
		}
	})
	t.Run("garbage returns nil", func(t *testing.T) {
		if got := parseIcebreakers("désolé"); got != nil {
			t.Fatalf("expected nil, got %+v", got)
		}
	})
}

func TestPickRandom(t *testing.T) {
	src := []string{"a", "b", "c", "d", "e"}
	got := pickRandom(src, 3)
	if len(got) != 3 {
		t.Fatalf("expected 3, got %d", len(got))
	}
	seen := map[string]bool{}
	for _, g := range got {
		if seen[g] {
			t.Fatalf("duplicate pick %q", g)
		}
		seen[g] = true
	}
	// n > len(src) : borné à la taille du pool.
	if got := pickRandom(src, 10); len(got) != len(src) {
		t.Fatalf("expected %d, got %d", len(src), len(got))
	}
}
