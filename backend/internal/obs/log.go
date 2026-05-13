package obs

import (
	"log/slog"
	"os"
	"strings"
)

// NewLogger renvoie un logger slog adapté à l'environnement.
//   - prod : JSON, niveau Info.
//   - dev  : texte coloré (par le terminal), niveau Debug.
//
// Aucun contenu de message de chat ne doit jamais transiter par ce logger.
// Voir CLAUDE.md §"Règles d'or" #1.
func NewLogger(env string) *slog.Logger {
	level := slog.LevelDebug
	if strings.EqualFold(env, "prod") {
		level = slog.LevelInfo
	}
	opts := &slog.HandlerOptions{Level: level}
	if strings.EqualFold(env, "prod") {
		return slog.New(slog.NewJSONHandler(os.Stdout, opts))
	}
	return slog.New(slog.NewTextHandler(os.Stdout, opts))
}
