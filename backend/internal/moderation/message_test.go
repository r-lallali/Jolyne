package moderation

import (
	"errors"
	"strings"
	"testing"
)

func TestSanitizeAndCheck(t *testing.T) {
	b := DefaultBlocklist()
	t.Run("ok simple", func(t *testing.T) {
		out, err := SanitizeAndCheck("salut", b)
		if err != nil || out != "salut" {
			t.Fatalf("got (%q, %v), want (\"salut\", nil)", out, err)
		}
	})
	t.Run("trim espaces", func(t *testing.T) {
		out, err := SanitizeAndCheck("  hello  ", b)
		if err != nil || out != "hello" {
			t.Fatalf("got (%q, %v)", out, err)
		}
	})
	t.Run("vide rejeté", func(t *testing.T) {
		_, err := SanitizeAndCheck("   ", b)
		if !errors.Is(err, ErrMessageEmpty) {
			t.Fatalf("got %v, want ErrMessageEmpty", err)
		}
	})
	t.Run("trop long rejeté", func(t *testing.T) {
		_, err := SanitizeAndCheck(strings.Repeat("a", 2001), b)
		if !errors.Is(err, ErrMessageTooLong) {
			t.Fatalf("got %v, want ErrMessageTooLong", err)
		}
	})
	t.Run("xss forward (la défense est côté client)", func(t *testing.T) {
		out, err := SanitizeAndCheck("<script>alert(1)</script>", b)
		if err != nil {
			t.Fatalf("err = %v", err)
		}
		if out != "<script>alert(1)</script>" {
			t.Fatalf("output altéré côté serveur : %q", out)
		}
	})
	t.Run("obscénité bloquée", func(t *testing.T) {
		_, err := SanitizeAndCheck("fuck off", b)
		if !errors.Is(err, ErrMessageBlocked) {
			t.Fatalf("got %v, want ErrMessageBlocked", err)
		}
	})
}
