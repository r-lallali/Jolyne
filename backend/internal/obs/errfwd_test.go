package obs

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
)

func newSpyLogger(fn ForwardFunc) (*slog.Logger, *bytes.Buffer) {
	var buf bytes.Buffer
	base := slog.New(slog.NewTextHandler(&buf, nil))
	return WithErrorForwarding(base, fn), &buf
}

func TestForwardsOnlyErrorRecords(t *testing.T) {
	var got []string
	log, buf := newSpyLogger(func(msg string, attrs map[string]string) {
		got = append(got, msg+"|"+attrs["err"])
	})

	log.Info("boot ok")
	log.Warn("presque grave")
	log.Error("stripe webhook", "err", "signature invalide")

	if len(got) != 1 || got[0] != "stripe webhook|signature invalide" {
		t.Fatalf("forwardés: %v", got)
	}
	// La sortie normale reste complète (le forwarding s'ajoute, ne remplace pas).
	for _, want := range []string{"boot ok", "presque grave", "stripe webhook"} {
		if !strings.Contains(buf.String(), want) {
			t.Fatalf("sortie slog sans %q: %s", want, buf.String())
		}
	}
}

func TestForwardingSurvivesDerivedLoggers(t *testing.T) {
	var got []string
	log, _ := newSpyLogger(func(msg string, attrs map[string]string) {
		got = append(got, msg)
	})

	log.With("component", "ws").Error("room perdue")
	log.WithGroup("stripe").Error("event inconnu")

	if len(got) != 2 {
		t.Fatalf("forwardés: %v", got)
	}
}

func TestNilForwardIsNoop(t *testing.T) {
	base := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	if WithErrorForwarding(base, nil) != base {
		t.Fatal("fn nil doit renvoyer le logger d'origine")
	}
}
