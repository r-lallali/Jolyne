package learn

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"
)

// Matrice de curriculum : chaque concept est défini UNE fois avec sa traduction
// dans les 10 langues. On en dérive les 10 cours (un par langue cible) : le mot
// cible est `words[lang]`, les sens sont `words` privé de la langue cible. Cela
// évite d'écrire 10 cours séparément et garantit des traductions cohérentes.
//
//go:embed seed/curriculum.json
var curriculumJSON []byte

// AllLangsOrdered : ordre d'affichage des cours (aligné sur l'i18n front).
var AllLangsOrdered = []string{"fr", "en", "es", "de", "pt", "it", "zh", "ja", "ko", "ar"}

type curItem struct {
	Words map[string]string `json:"words"`
}

type curLesson struct {
	Slug  string    `json:"slug"`
	Title string    `json:"title"`
	Items []curItem `json:"items"`
}

type curUnit struct {
	Slug    string      `json:"slug"`
	Title   string      `json:"title"`
	Lessons []curLesson `json:"lessons"`
}

type curriculum struct {
	Units []curUnit `json:"units"`
}

func loadCurriculum() (curriculum, error) {
	var c curriculum
	if err := json.Unmarshal(curriculumJSON, &c); err != nil {
		return curriculum{}, fmt.Errorf("learn: parse curriculum: %w", err)
	}
	return c, nil
}

// BuildCourses : construit les 10 cours à partir de la matrice. Pour chaque
// langue cible, on prend `words[lang]` comme cible et toutes les autres langues
// comme sens. Un item dont la langue cible manque est ignoré (la matrice est
// censée être complète — voir le test).
func BuildCourses() ([]Course, error) {
	cur, err := loadCurriculum()
	if err != nil {
		return nil, err
	}
	out := make([]Course, 0, len(AllLangsOrdered))
	for _, lang := range AllLangsOrdered {
		c := Course{Lang: lang, Title: targetLangName[lang]}
		for _, u := range cur.Units {
			unit := Unit{Slug: u.Slug, Title: u.Title}
			for _, l := range u.Lessons {
				lesson := Lesson{Slug: l.Slug, Title: l.Title, XP: 10}
				for _, it := range l.Items {
					target := it.Words[lang]
					if target == "" {
						continue
					}
					tr := make(map[string]string, len(it.Words)-1)
					for k, v := range it.Words {
						if k != lang && v != "" {
							tr[k] = v
						}
					}
					lesson.Items = append(lesson.Items, Item{Target: target, Tr: tr})
				}
				if len(lesson.Items) > 0 {
					unit.Lessons = append(unit.Lessons, lesson)
				}
			}
			if len(unit.Lessons) > 0 {
				c.Units = append(c.Units, unit)
			}
		}
		out = append(out, c)
	}
	return out, nil
}

// SeedCourses : (ré)écrit les 10 cours dérivés de la matrice. Idempotent et
// non destructif pour la progression jouée (les leçons sont identifiées par
// slug ; UpsertCourse réconcilie en supprimant uniquement les unités/leçons
// qui ne sont plus dans la matrice). Appelé au boot du gateway.
func SeedCourses(ctx context.Context, store *Store, log *slog.Logger) error {
	courses, err := BuildCourses()
	if err != nil {
		return err
	}
	for _, c := range courses {
		cctx, cancel := context.WithTimeout(ctx, 15*time.Second)
		err := store.UpsertCourse(cctx, c)
		cancel()
		if err != nil {
			return fmt.Errorf("learn: seed %s: %w", c.Lang, err)
		}
	}
	if log != nil {
		lessons := 0
		if len(courses) > 0 {
			for _, u := range courses[0].Units {
				lessons += len(u.Lessons)
			}
		}
		log.Info("learn courses seeded", "courses", len(courses), "lessons_each", lessons)
	}
	return nil
}
