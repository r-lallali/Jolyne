package obs

import (
	"context"
	"log/slog"
)

// ForwardFunc reçoit chaque record de niveau Error (message + attributs
// aplatis en texte). Branché sur Sentry par main quand SENTRY_DSN est posé.
// Sûr par construction : la taxonomie des logs ne contient jamais de contenu
// de message de chat ni de PII (règles d'or #1 et #6).
type ForwardFunc func(msg string, attrs map[string]string)

// WithErrorForwarding duplique les records Error+ du logger vers fn, en plus
// de la sortie normale. fn nil → logger inchangé.
func WithErrorForwarding(l *slog.Logger, fn ForwardFunc) *slog.Logger {
	if fn == nil {
		return l
	}
	return slog.New(&forwardHandler{Handler: l.Handler(), fn: fn})
}

type forwardHandler struct {
	slog.Handler
	fn ForwardFunc
}

func (h *forwardHandler) Handle(ctx context.Context, r slog.Record) error {
	if r.Level >= slog.LevelError {
		attrs := make(map[string]string, r.NumAttrs())
		r.Attrs(func(a slog.Attr) bool {
			attrs[a.Key] = a.Value.String()
			return true
		})
		h.fn(r.Message, attrs)
	}
	return h.Handler.Handle(ctx, r)
}

// WithAttrs / WithGroup préservent le forwarding sur les loggers dérivés
// (log.With(...)) — sans quoi seuls les records du logger racine partiraient.
func (h *forwardHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &forwardHandler{Handler: h.Handler.WithAttrs(attrs), fn: h.fn}
}

func (h *forwardHandler) WithGroup(name string) slog.Handler {
	return &forwardHandler{Handler: h.Handler.WithGroup(name), fn: h.fn}
}
