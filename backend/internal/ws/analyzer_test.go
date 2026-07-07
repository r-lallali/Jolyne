package ws

import "testing"

func TestParseAnalysis(t *testing.T) {
	t.Run("object wrapped in prose", func(t *testing.T) {
		raw := `Voici : {"vocab":[{"term":"chat","translation":"cat"},{"term":"maison","translation":"house"}],` +
			`"mistakes":[{"original":"je suis allé au plage","corrected":"je suis allé à la plage","note":"plage est féminin"}],` +
			`"cefr":"B1"} fin`
		a := parseAnalysis(raw, 8, 6)
		if len(a.Vocab) != 2 || a.Vocab[0].Term != "chat" || a.Vocab[1].Translation != "house" {
			t.Fatalf("vocab: got %+v", a.Vocab)
		}
		if len(a.Mistakes) != 1 || a.Mistakes[0].Corrected != "je suis allé à la plage" {
			t.Fatalf("mistakes: got %+v", a.Mistakes)
		}
		if a.CEFR != "B1" {
			t.Fatalf("cefr: got %q", a.CEFR)
		}
	})
	t.Run("capped to max", func(t *testing.T) {
		raw := `{"vocab":[{"term":"a","translation":"1"},{"term":"b","translation":"2"},{"term":"c","translation":"3"}],` +
			`"mistakes":[{"original":"x","corrected":"y"},{"original":"z","corrected":"w"}],"cefr":""}`
		a := parseAnalysis(raw, 2, 1)
		if len(a.Vocab) != 2 {
			t.Fatalf("expected vocab cap at 2, got %d", len(a.Vocab))
		}
		if len(a.Mistakes) != 1 {
			t.Fatalf("expected mistakes cap at 1, got %d", len(a.Mistakes))
		}
	})
	t.Run("garbage returns empty", func(t *testing.T) {
		a := parseAnalysis("désolé, rien à extraire", 8, 6)
		if len(a.Vocab) != 0 || len(a.Mistakes) != 0 || a.CEFR != "" {
			t.Fatalf("expected empty, got %+v", a)
		}
	})
	t.Run("empty object", func(t *testing.T) {
		a := parseAnalysis("{}", 8, 6)
		if len(a.Vocab) != 0 || len(a.Mistakes) != 0 {
			t.Fatalf("expected empty, got %+v", a)
		}
	})
}

func TestCEFRScore(t *testing.T) {
	cases := []struct {
		in   string
		want float64
		ok   bool
	}{
		{"A1", 1, true},
		{"b2", 4, true},
		{" C2 ", 6, true},
		{"", 0, false},
		{"Z9", 0, false},
	}
	for _, c := range cases {
		got, ok := cefrScore(c.in)
		if got != c.want || ok != c.ok {
			t.Fatalf("cefrScore(%q) = %v,%v ; want %v,%v", c.in, got, ok, c.want, c.ok)
		}
	}
}
