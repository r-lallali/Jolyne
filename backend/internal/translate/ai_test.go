package translate_test

import (
	"context"
	"errors"
	"testing"

	"github.com/ralys/jolyne/backend/internal/translate"
)

func fakeReply(response string, err error) translate.ReplyFunc {
	return func(ctx context.Context, system, userMsg string) (string, error) {
		return response, err
	}
}

func TestAITranslator_ParsesStrictJSON(t *testing.T) {
	a := &translate.AITranslator{Reply: fakeReply(
		`{"translation":"Bonjour, comment ça va ?","detected":"zh","romanization":"nǐ hǎo ma"}`, nil,
	)}
	res, err := a.Translate(context.Background(), "你好吗", "en", "fr")
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	if res.Translated != "Bonjour, comment ça va ?" {
		t.Fatalf("translated: %q", res.Translated)
	}
	if res.Detected != "zh" {
		t.Fatalf("detected: %q", res.Detected)
	}
	if res.Romanization != "nǐ hǎo ma" {
		t.Fatalf("romanization: %q", res.Romanization)
	}
}

func TestAITranslator_ToleratesFences(t *testing.T) {
	a := &translate.AITranslator{Reply: fakeReply(
		"```json\n{\"translation\":\"hello\",\"detected\":\"fr\",\"romanization\":\"\"}\n```", nil,
	)}
	res, err := a.Translate(context.Background(), "bonjour", "fr", "en")
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	if res.Translated != "hello" || res.Detected != "fr" {
		t.Fatalf("res: %+v", res)
	}
}

func TestAITranslator_DropsInvalidDetected(t *testing.T) {
	a := &translate.AITranslator{Reply: fakeReply(
		`{"translation":"x","detected":"klingon","romanization":""}`, nil,
	)}
	res, err := a.Translate(context.Background(), "y", "en", "fr")
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	if res.Detected != "" {
		t.Fatalf("detected fantaisiste devrait être vidé: %q", res.Detected)
	}
}

func TestAITranslator_DropsRomanizationForLatinSource(t *testing.T) {
	a := &translate.AITranslator{Reply: fakeReply(
		`{"translation":"hola","detected":"fr","romanization":"o-la"}`, nil,
	)}
	res, err := a.Translate(context.Background(), "salut", "fr", "es")
	if err != nil {
		t.Fatalf("translate: %v", err)
	}
	if res.Romanization != "" {
		t.Fatalf("romanisation d'une source latine devrait être vidée: %q", res.Romanization)
	}
}

func TestAITranslator_EmptyTranslationIsError(t *testing.T) {
	a := &translate.AITranslator{Reply: fakeReply(`{"translation":"  "}`, nil)}
	if _, err := a.Translate(context.Background(), "x", "en", "fr"); err == nil {
		t.Fatal("traduction vide doit être une erreur (déclenche le fallback)")
	}
}

func TestAITranslator_NonJSONIsError(t *testing.T) {
	a := &translate.AITranslator{Reply: fakeReply("désolé, je ne peux pas", nil)}
	if _, err := a.Translate(context.Background(), "x", "en", "fr"); err == nil {
		t.Fatal("réponse sans JSON doit être une erreur")
	}
}

func TestAITranslator_PropagatesUpstreamError(t *testing.T) {
	a := &translate.AITranslator{Reply: fakeReply("", errors.New("api down"))}
	if _, err := a.Translate(context.Background(), "x", "en", "fr"); err == nil {
		t.Fatal("erreur API doit être propagée")
	}
}
