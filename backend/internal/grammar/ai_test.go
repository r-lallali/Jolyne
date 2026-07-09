package grammar_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ralys/jolyne/backend/internal/grammar"
)

func fakeChecker(raw string, err error) *grammar.AIChecker {
	return &grammar.AIChecker{
		Reply: func(ctx context.Context, system, userMsg string) (string, error) {
			return raw, err
		},
	}
}

func TestAIChecker_Check_AnchorsOffsetsUTF16(t *testing.T) {
	// "안녕하세요 저는 학생이예요" : la faute "이예요" commence au 11e char
	// UTF-16 (les Hangul sont BMP = 1 unité chacun).
	a := fakeChecker(`{"errors":[{"wrong":"이예요","fixes":["이에요"],"note":"받침 없는 말 뒤에는 '이에요'"}]}`, nil)
	matches, err := a.Check(context.Background(), "안녕하세요 저는 학생이예요", "ko")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if len(matches) != 1 {
		t.Fatalf("matches: %+v", matches)
	}
	m := matches[0]
	if m.Offset != 11 || m.Length != 3 {
		t.Fatalf("offset/length UTF-16 attendus 11/3, eu %d/%d", m.Offset, m.Length)
	}
	if len(m.Replacements) != 1 || m.Replacements[0] != "이에요" {
		t.Fatalf("replacements: %+v", m.Replacements)
	}
}

func TestAIChecker_Check_CountsAstralRunesTwice(t *testing.T) {
	// Un emoji (hors BMP) compte 2 unités UTF-16, comme dans une string JS :
	// "😀 학생이예요" → 😀(2) + espace(1) + 학생(2) = offset 5.
	a := fakeChecker(`{"errors":[{"wrong":"이예요","fixes":["이에요"],"note":"x"}]}`, nil)
	matches, err := a.Check(context.Background(), "😀 학생이예요", "ko")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if len(matches) != 1 || matches[0].Offset != 5 {
		t.Fatalf("offset attendu 5, eu %+v", matches)
	}
}

func TestAIChecker_Check_SkipsHallucinatedExtract(t *testing.T) {
	a := fakeChecker(`{"errors":[
		{"wrong":"absent du texte","fixes":["x"],"note":"n"},
		{"wrong":"이예요","fixes":["이에요"],"note":"n"}
	]}`, nil)
	matches, err := a.Check(context.Background(), "학생이예요", "ko")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if len(matches) != 1 || matches[0].Offset != 2 {
		t.Fatalf("seule la faute ancrée doit rester: %+v", matches)
	}
}

func TestAIChecker_Check_AnchorsDuplicatesInOrder(t *testing.T) {
	// Deux occurrences du même extrait fautif : la 2e faute doit s'ancrer
	// après la 1re, pas dessus.
	a := fakeChecker(`{"errors":[
		{"wrong":"갔어","fixes":["갔어요"],"note":"n"},
		{"wrong":"갔어","fixes":["갔어요"],"note":"n"}
	]}`, nil)
	matches, err := a.Check(context.Background(), "학교 갔어 집에 갔어", "ko")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if len(matches) != 2 {
		t.Fatalf("matches: %+v", matches)
	}
	if matches[0].Offset != 3 || matches[1].Offset != 9 {
		t.Fatalf("offsets attendus 3 et 9, eu %d et %d", matches[0].Offset, matches[1].Offset)
	}
}

func TestAIChecker_Check_CapsReplacementsAtFive(t *testing.T) {
	a := fakeChecker(`{"errors":[{"wrong":"x","fixes":["a","b","c","d","e","f","g"],"note":"n"}]}`, nil)
	matches, err := a.Check(context.Background(), "x", "ko")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if len(matches[0].Replacements) != 5 {
		t.Fatalf("replacements doivent être tronqués à 5, eu %d", len(matches[0].Replacements))
	}
}

func TestAIChecker_Check_EmptyErrorsIsClean(t *testing.T) {
	a := fakeChecker(`{"errors":[]}`, nil)
	matches, err := a.Check(context.Background(), "완벽한 문장이에요", "ko")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if matches == nil || len(matches) != 0 {
		t.Fatalf("texte correct = slice vide non-nil, eu %#v", matches)
	}
}

func TestAIChecker_Check_ToleratesMarkdownFences(t *testing.T) {
	a := fakeChecker("```json\n{\"errors\":[]}\n```", nil)
	if _, err := a.Check(context.Background(), "x", "ko"); err != nil {
		t.Fatalf("les fences doivent être tolérées: %v", err)
	}
}

func TestAIChecker_Check_PropagatesErrors(t *testing.T) {
	a := fakeChecker("", errors.New("api down"))
	if _, err := a.Check(context.Background(), "x", "ko"); err == nil {
		t.Fatal("erreur API doit être propagée")
	}
	a = fakeChecker("pas de json ici", nil)
	if _, err := a.Check(context.Background(), "x", "ko"); err == nil {
		t.Fatal("réponse sans JSON doit être une erreur")
	}
}

func TestGrammarHandler_KoreanRequiresAI(t *testing.T) {
	h := newHandler("http://invalid") // pas d'AIChecker
	req := httptest.NewRequest(http.MethodPost, "/api/grammar", strings.NewReader(`{"text":"학생이예요","lang":"ko"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("ko sans IA doit répondre 400, eu %d", rec.Code)
	}
}

func TestGrammarHandler_KoreanServedByAI(t *testing.T) {
	var ltCalls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ltCalls++
	}))
	defer srv.Close()
	h := newHandler(srv.URL)
	h.AI = fakeChecker(`{"errors":[{"wrong":"이예요","fixes":["이에요"],"note":"n"}]}`, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/grammar", strings.NewReader(`{"text":"학생이예요","lang":"KO-kr"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: %d (%s)", rec.Code, rec.Body.String())
	}
	if ltCalls != 0 {
		t.Fatalf("le coréen ne doit pas passer par LanguageTool, eu %d appels", ltCalls)
	}
	if !strings.Contains(rec.Body.String(), "이에요") {
		t.Fatalf("body: %s", rec.Body.String())
	}
}
