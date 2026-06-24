package learn

import (
	"embed"
	"encoding/json"
	"fmt"
)

// Module « Écriture » : seed des leçons d'apprentissage du système d'écriture
// pour les langues à script non latin. Contrairement au curriculum de
// vocabulaire (matrice partagée par les 10 langues), les signes sont propres à
// chaque langue → un fichier seed par langue. Ces unités sont préfixées devant
// les unités de vocabulaire dans BuildCourses (cf. seed.go).
//
//go:embed seed/scripts/*.json
var scriptFS embed.FS

// ScriptLangs : langues disposant d'un module d'écriture (ordre = ordre des
// unités script en tête de cours).
var ScriptLangs = []string{"ja", "ko", "ar", "zh"}

// LessonKindScript : valeur du champ kind pour une leçon d'écriture.
const LessonKindScript = "script"

// scriptItem : item du seed script. `glyph` devient Item.Target ; `sound` la
// prononciation universelle (Item.Sound). Les champs forms/parts/strokes sont
// propres à certaines activités (formes arabes, composition Hangul, tracé).
type scriptItem struct {
	Glyph        string   `json:"glyph"`
	Sound        string   `json:"sound"`
	Forms        []string `json:"forms,omitempty"`
	Parts        []string `json:"parts,omitempty"`
	Strokes      []string `json:"strokes,omitempty"`
	Example      string   `json:"example,omitempty"`
	ExampleSound string   `json:"example_sound,omitempty"`
}

type scriptLesson struct {
	Slug  string       `json:"slug"`
	Title string       `json:"title"`
	Items []scriptItem `json:"items"`
}

type scriptUnit struct {
	Slug    string         `json:"slug"`
	Title   string         `json:"title"`
	Lessons []scriptLesson `json:"lessons"`
}

type scriptCurriculum struct {
	Units []scriptUnit `json:"units"`
}

// loadScriptCurriculum : lit le seed d'écriture d'une langue. Renvoie (nil, nil)
// si la langue n'a pas de module d'écriture (pas de fichier embarqué).
func loadScriptCurriculum(lang string) (*scriptCurriculum, error) {
	raw, err := scriptFS.ReadFile("seed/scripts/" + lang + ".json")
	if err != nil {
		// Absence de fichier = langue sans module d'écriture (non bloquant).
		return nil, nil //nolint:nilerr
	}
	var sc scriptCurriculum
	if err := json.Unmarshal(raw, &sc); err != nil {
		return nil, fmt.Errorf("learn: parse script seed %q: %w", lang, err)
	}
	return &sc, nil
}

// BuildScriptUnits : unités d'écriture d'une langue, prêtes à préfixer le cours.
// Toutes les leçons sont marquées Kind="script". Renvoie nil si pas de module.
func BuildScriptUnits(lang string) ([]Unit, error) {
	sc, err := loadScriptCurriculum(lang)
	if err != nil {
		return nil, err
	}
	if sc == nil {
		return nil, nil
	}
	units := make([]Unit, 0, len(sc.Units))
	for _, u := range sc.Units {
		unit := Unit{Slug: u.Slug, Title: u.Title}
		for _, l := range u.Lessons {
			lesson := Lesson{Slug: l.Slug, Title: l.Title, XP: 10, Kind: LessonKindScript}
			for _, it := range l.Items {
				if it.Glyph == "" {
					continue
				}
				lesson.Items = append(lesson.Items, Item{
					Target:       it.Glyph,
					Sound:        it.Sound,
					Forms:        it.Forms,
					Parts:        it.Parts,
					Strokes:      it.Strokes,
					Example:      it.Example,
					ExampleSound: it.ExampleSound,
				})
			}
			if len(lesson.Items) > 0 {
				unit.Lessons = append(unit.Lessons, lesson)
			}
		}
		if len(unit.Lessons) > 0 {
			units = append(units, unit)
		}
	}
	return units, nil
}
