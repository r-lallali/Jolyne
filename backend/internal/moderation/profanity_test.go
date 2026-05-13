package moderation

import "testing"

func TestBlocklistContains(t *testing.T) {
	b := DefaultBlocklist()
	cases := []struct {
		in   string
		want bool
	}{
		{"hello world", false},
		{"je veux manger", false},
		{"alice", false},
		{"fuck", true},
		{"FuCk you", true},
		{"f-u-c-k", true},   // ponctuation ignorée par normalize
		{"fück", true},      // accent retiré
		{"phuck", false},    // bypass non géré par notre normalize basique — documenté
		{"p0rn site", true}, // 0→o
		{"pédophile", true},
		{"PEDO mode", true},
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			got := b.Contains(tc.in)
			if got != tc.want {
				t.Fatalf("Contains(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}
