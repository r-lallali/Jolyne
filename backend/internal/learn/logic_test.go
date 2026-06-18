package learn

import (
	"testing"
	"time"
)

func TestRegenHearts(t *testing.T) {
	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)

	// Plein → reste plein, pas de timer.
	if cur, _, next := regenHearts(MaxHearts, now.Add(-time.Hour), now); cur != MaxHearts || next != 0 {
		t.Fatalf("full: got cur=%d next=%d", cur, next)
	}

	// 3 cœurs, 31 min écoulées → +1.
	cur, upd, next := regenHearts(3, now.Add(-31*time.Minute), now)
	if cur != 4 {
		t.Fatalf("regen +1: got %d, want 4", cur)
	}
	if next <= 0 {
		t.Fatalf("regen +1: expected positive next, got %d", next)
	}
	// L'horodatage avance d'un multiple entier de HeartRegen (pas jusqu'à now).
	if !upd.Equal(now.Add(-31 * time.Minute).Add(HeartRegen)) {
		t.Fatalf("regen +1: updatedAt mal avancé: %v", upd)
	}

	// 0 cœur, 61 min → +2.
	if cur, _, _ := regenHearts(0, now.Add(-61*time.Minute), now); cur != 2 {
		t.Fatalf("regen +2: got %d, want 2", cur)
	}

	// Régénération qui dépasse le max est plafonnée.
	if cur, _, next := regenHearts(4, now.Add(-3*time.Hour), now); cur != MaxHearts || next != 0 {
		t.Fatalf("regen cap: got cur=%d next=%d", cur, next)
	}
}

func TestDaysBetweenUTC(t *testing.T) {
	d := time.Date(2026, 6, 17, 23, 0, 0, 0, time.UTC)
	now := time.Date(2026, 6, 18, 1, 0, 0, 0, time.UTC)
	if got := daysBetweenUTC(d, now); got != 1 {
		t.Fatalf("got %d, want 1", got)
	}
	if got := daysBetweenUTC(now, now); got != 0 {
		t.Fatalf("same day: got %d, want 0", got)
	}
}

func TestStarsFromMistakes(t *testing.T) {
	cases := map[int]int{0: 3, 1: 2, 2: 2, 3: 1, 9: 1}
	for mistakes, want := range cases {
		if got := starsFromMistakes(mistakes); got != want {
			t.Fatalf("mistakes=%d: got %d, want %d", mistakes, got, want)
		}
	}
}

func TestResolveMeaning(t *testing.T) {
	it := Item{Target: "Hello", Tr: map[string]string{"fr": "Bonjour", "en": "Hello"}}
	if got := resolveMeaning(it, "fr"); got != "Bonjour" {
		t.Fatalf("direct: got %q", got)
	}
	// Repli sur l'anglais si la langue demandée manque.
	if got := resolveMeaning(it, "de"); got != "Hello" {
		t.Fatalf("fallback en: got %q", got)
	}
	// Repli sur n'importe quelle traduction si ni la langue ni en.
	only := Item{Target: "Hi", Tr: map[string]string{"es": "Hola"}}
	if got := resolveMeaning(only, "de"); got != "Hola" {
		t.Fatalf("fallback any: got %q", got)
	}
}

func TestVocabBand(t *testing.T) {
	// Plus l'unité est avancée, plus on autorise de mots / de longueur.
	cases := []struct {
		unit, words, length int
	}{
		{0, 1, 12}, {1, 1, 12}, {2, 2, 20}, {3, 2, 20}, {4, 4, 40}, {9, 4, 40},
	}
	for _, c := range cases {
		w, l := vocabBand(c.unit)
		if w != c.words || l != c.length {
			t.Fatalf("unit=%d: got (%d,%d), want (%d,%d)", c.unit, w, l, c.words, c.length)
		}
	}
}

func TestPickVocab(t *testing.T) {
	cands := []PlayItem{
		{Target: "a"}, {Target: "b"}, {Target: "c"}, {Target: "d"},
	}
	// Sélection bornée à k.
	if got := pickVocab(cands, 0, 2); len(got) != 2 {
		t.Fatalf("k=2: got %d", len(got))
	}
	// Stable et décalée par leçon : la leçon 1 commence un cran plus loin.
	g0 := pickVocab(cands, 0, 2)
	g1 := pickVocab(cands, 1, 2)
	if g0[0].Target == g1[0].Target {
		t.Fatalf("expected different offset across lessons, both started at %q", g0[0].Target)
	}
	// Moins de candidats que k → tout est renvoyé.
	if got := pickVocab(cands[:1], 0, 2); len(got) != 1 {
		t.Fatalf("fewer than k: got %d", len(got))
	}
	if got := pickVocab(nil, 0, 2); got != nil {
		t.Fatalf("nil candidates: got %v", got)
	}
}

func TestBuiltCoursesAreValid(t *testing.T) {
	courses, err := BuildCourses()
	if err != nil {
		t.Fatalf("build courses: %v", err)
	}
	if len(courses) != len(AllLangsOrdered) {
		t.Fatalf("attendu %d cours, obtenu %d", len(AllLangsOrdered), len(courses))
	}
	for _, c := range courses {
		if !IsSupportedLang(c.Lang) {
			t.Fatalf("langue non supportée: %q", c.Lang)
		}
		// validateCourse exige une traduction pour CHAQUE langue source : ce test
		// garantit donc que la matrice de curriculum est complète (10/10) pour
		// chaque concept.
		sources := sourceLangsFor(c.Lang)
		if err := validateCourse(c, c.Lang, sources); err != nil {
			t.Fatalf("cours %q invalide: %v", c.Lang, err)
		}
	}
}
