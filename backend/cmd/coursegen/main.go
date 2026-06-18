// Commande coursegen : génère un (ou plusieurs) cours du mode Cours via Claude
// et les persiste en base. Le contenu est ainsi produit UNE fois puis servi
// gratuitement par le gateway au runtime.
//
// Usage :
//
//	POSTGRES_DSN=... ANTHROPIC_API_KEY=... go run ./cmd/coursegen -langs en,es,de
//
// Options : -langs (codes séparés par des virgules), -units, -lessons, -items.
// Nécessite POSTGRES_DSN et ANTHROPIC_API_KEY dans l'environnement.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/ralys/jolyne/backend/internal/claudeapi"
	"github.com/ralys/jolyne/backend/internal/db"
	"github.com/ralys/jolyne/backend/internal/learn"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "coursegen: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	langs := flag.String("langs", "en", "langues cibles à générer (codes séparés par des virgules)")
	units := flag.Int("units", 4, "nombre d'unités par cours")
	lessons := flag.Int("lessons", 4, "nombre de leçons par unité")
	items := flag.Int("items", 6, "nombre d'items par leçon")
	flag.Parse()

	dsn := os.Getenv("POSTGRES_DSN")
	if dsn == "" {
		return fmt.Errorf("POSTGRES_DSN requis")
	}
	apiKey := os.Getenv("ANTHROPIC_API_KEY")
	if apiKey == "" {
		return fmt.Errorf("ANTHROPIC_API_KEY requis")
	}
	model := os.Getenv("ANTHROPIC_MODEL")
	if model == "" {
		model = "claude-haiku-4-5-20251001"
	}

	log := slog.New(slog.NewTextHandler(os.Stderr, nil))

	ctx := context.Background()
	if err := db.RunMigrations(dsn); err != nil {
		return fmt.Errorf("migrations: %w", err)
	}
	pool, err := db.New(ctx, dsn)
	if err != nil {
		return fmt.Errorf("postgres: %w", err)
	}
	defer pool.Close()

	store := learn.NewStore(pool)
	client := claudeapi.New(apiKey, claudeapi.WithModel(model), claudeapi.WithLogger(log))

	for _, l := range strings.Split(*langs, ",") {
		lang := strings.ToLower(strings.TrimSpace(l))
		if lang == "" {
			continue
		}
		if !learn.IsSupportedLang(lang) {
			log.Warn("langue ignorée (non supportée)", "lang", lang)
			continue
		}
		log.Info("génération en cours", "lang", lang, "units", *units, "lessons", *lessons, "items", *items)
		genCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
		course, err := learn.GenerateCourse(genCtx, client, lang, *units, *lessons, *items)
		cancel()
		if err != nil {
			log.Error("génération échouée", "lang", lang, "err", err)
			continue
		}
		if err := store.UpsertCourse(ctx, course); err != nil {
			log.Error("persistance échouée", "lang", lang, "err", err)
			continue
		}
		total := 0
		for _, u := range course.Units {
			total += len(u.Lessons)
		}
		log.Info("cours généré et persisté", "lang", lang, "units", len(course.Units), "lessons", total)
	}
	return nil
}
