package ws

import (
	"html"
	"testing"
)

func TestDetectLang(t *testing.T) {
	cases := []struct {
		text string
		want string
	}{
		{"Bonjour, je voudrais savoir comment tu vas aujourd'hui mon ami", "fr"},
		{"I went to the market yesterday and bought some fresh vegetables", "en"},
		{"Hola, ¿cómo estás? Hoy quiero practicar mi español contigo porque tengo un examen", "es"},
		{"今日は天気がとても良いので、公園まで散歩に行きました。", "ja"},
	}
	for _, c := range cases {
		if got := detectLang(c.text); got != c.want {
			t.Errorf("detectLang(%q) = %q, want %q", c.text, got, c.want)
		}
	}
}

func TestLangNudge(t *testing.T) {
	frMsg := html.EscapeString("Bonjour, je voudrais te raconter ma journée d'hier parce qu'elle était intéressante")
	enMsg := html.EscapeString("Yesterday I went to the cinema with my friends and we watched a great movie")

	t.Run("streak in native lang triggers once", func(t *testing.T) {
		n := newLangNudge("fr", "en")
		var got []string
		for i := 0; i < nudgeThreshold+3; i++ {
			if code := n.observe(frMsg); code != "" {
				got = append(got, code)
			}
		}
		if len(got) != 1 || got[0] != NudgePracticeLang {
			t.Fatalf("expected exactly one practice nudge, got %v", got)
		}
	})

	t.Run("target lang resets streak", func(t *testing.T) {
		n := newLangNudge("fr", "en")
		for i := 0; i < nudgeThreshold-1; i++ {
			if code := n.observe(frMsg); code != "" {
				t.Fatalf("premature nudge at %d", i)
			}
		}
		if code := n.observe(enMsg); code != "" {
			t.Fatalf("unexpected nudge on target lang")
		}
		// Le compteur est reparti de zéro : un message natif de plus ne
		// suffit pas.
		if code := n.observe(frMsg); code != "" {
			t.Fatalf("nudge should not fire right after reset")
		}
	})

	t.Run("short messages ignored", func(t *testing.T) {
		n := newLangNudge("fr", "en")
		for i := 0; i < nudgeThreshold*3; i++ {
			if code := n.observe("ok"); code != "" {
				t.Fatalf("short message must not count")
			}
		}
	})

	t.Run("tandem phase uses short threshold and rearms per phase", func(t *testing.T) {
		n := newLangNudge("fr", "en")
		n.setTandemLang("en")
		var got []string
		for i := 0; i < nudgeTandemThreshold*2; i++ {
			if code := n.observe(frMsg); code != "" {
				got = append(got, code)
			}
		}
		if len(got) != 1 || got[0] != NudgeTandemLang {
			t.Fatalf("expected one tandem nudge, got %v", got)
		}
		// Nouvelle phase : le rappel se ré-arme.
		n.setTandemLang("fr")
		got = nil
		for i := 0; i < nudgeTandemThreshold; i++ {
			if code := n.observe(enMsg); code != "" {
				got = append(got, code)
			}
		}
		if len(got) != 1 || got[0] != NudgeTandemLang {
			t.Fatalf("expected tandem nudge after switch, got %v", got)
		}
	})
}
