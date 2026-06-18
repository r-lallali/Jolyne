package learn

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log/slog"
	"time"
)

//go:embed seed/*.json
var seedFS embed.FS

// LoadSeedCourses : lit tous les cours embarqués (seed/*.json). Sert au seed
// au boot et de base de référence au générateur Claude (même schéma JSON).
func LoadSeedCourses() ([]Course, error) {
	entries, err := fs.ReadDir(seedFS, "seed")
	if err != nil {
		return nil, fmt.Errorf("learn: read seed dir: %w", err)
	}
	var out []Course
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		b, err := seedFS.ReadFile("seed/" + e.Name())
		if err != nil {
			return nil, fmt.Errorf("learn: read seed %s: %w", e.Name(), err)
		}
		var c Course
		if err := json.Unmarshal(b, &c); err != nil {
			return nil, fmt.Errorf("learn: parse seed %s: %w", e.Name(), err)
		}
		out = append(out, c)
	}
	return out, nil
}

// SeedIfEmpty : insère les cours embarqués absents de la base. Idempotent et
// non destructif — si un cours existe déjà (même langue), on le laisse tel
// quel pour ne pas écraser un cours plus riche généré par Claude. Appelé au
// boot du gateway.
func SeedIfEmpty(ctx context.Context, store *Store, log *slog.Logger) error {
	courses, err := LoadSeedCourses()
	if err != nil {
		return err
	}
	for _, c := range courses {
		exists, err := store.CourseExists(ctx, c.Lang)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		err = store.UpsertCourse(cctx, c)
		cancel()
		if err != nil {
			return fmt.Errorf("learn: seed %s: %w", c.Lang, err)
		}
		if log != nil {
			lessons := 0
			for _, u := range c.Units {
				lessons += len(u.Lessons)
			}
			log.Info("learn course seeded", "lang", c.Lang, "units", len(c.Units), "lessons", lessons)
		}
	}
	return nil
}
