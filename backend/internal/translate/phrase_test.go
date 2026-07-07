package translate

import "testing"

func TestIsPhrase(t *testing.T) {
	cases := []struct {
		text string
		want bool
	}{
		{"hello", false},
		{"你好", false},
		{"bonjour", false},
		{"hello everyone", true},
		{"comment ça va", true},
		{"我喜欢学习法语和中文", false}, // 10 runes — sous le seuil
		{"我喜欢学习法语和中文因为很有趣", true},
		{"Donaudampfschifffahrt", true}, // mot unique ≥ 12 runes
	}
	for _, c := range cases {
		if got := isPhrase(c.text); got != c.want {
			t.Errorf("isPhrase(%q) = %v, attendu %v", c.text, got, c.want)
		}
	}
}

func TestSameText(t *testing.T) {
	if !sameText(" Hello ", "hello") {
		t.Error("sameText devrait ignorer casse et espaces de bord")
	}
	if sameText("hello", "bonjour") {
		t.Error("textes différents")
	}
}
