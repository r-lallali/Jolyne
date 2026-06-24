package learn

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/ralys/jolyne/backend/internal/claudeapi"
)

// targetLangName : autonyme de la langue cible, pour le prompt et le titre.
var targetLangName = map[string]string{
	"fr": "Français", "en": "English", "es": "Español", "de": "Deutsch",
	"pt": "Português", "it": "Italiano", "zh": "中文", "ja": "日本語",
	"ko": "한국어", "ar": "العربية",
}

// sourceLangsFor : toutes les langues sources (les 9 autres) pour lesquelles le
// générateur doit fournir une traduction de chaque item.
func sourceLangsFor(target string) []string {
	order := []string{"fr", "en", "es", "de", "pt", "it", "zh", "ja", "ko", "ar"}
	out := make([]string, 0, len(order)-1)
	for _, l := range order {
		if l != target {
			out = append(out, l)
		}
	}
	return out
}

// GenerateCourse : demande à Claude un cours complet pour `targetLang`, au
// format Course (mêmes champs que le seed). Le contenu est généré une fois puis
// persisté via Store.UpsertCourse — le runtime reste gratuit. Le résultat est
// validé (langue, présence des traductions) avant d'être renvoyé.
func GenerateCourse(ctx context.Context, c *claudeapi.Client, targetLang string, units, lessonsPerUnit, itemsPerLesson int) (Course, error) {
	if !IsSupportedLang(targetLang) {
		return Course{}, fmt.Errorf("learn: langue cible non supportée: %q", targetLang)
	}
	if c == nil || !c.Enabled() {
		return Course{}, fmt.Errorf("learn: client Claude non configuré")
	}
	sources := sourceLangsFor(targetLang)
	system := buildGenSystemPrompt(targetLang, sources, units, lessonsPerUnit, itemsPerLesson)
	user := fmt.Sprintf(
		"Génère le cours d'apprentissage de %s (code %q) au format JSON demandé. Réponds UNIQUEMENT avec le JSON.",
		targetLangName[targetLang], targetLang,
	)
	raw, err := c.Reply(ctx, system, nil, user)
	if err != nil {
		return Course{}, fmt.Errorf("learn: génération Claude: %w", err)
	}
	course, err := parseCourseJSON(raw)
	if err != nil {
		return Course{}, err
	}
	course.Lang = targetLang
	if course.Title == "" {
		course.Title = targetLangName[targetLang]
	}
	if err := validateCourse(course, targetLang, sources); err != nil {
		return Course{}, err
	}
	return course, nil
}

func buildGenSystemPrompt(target string, sources []string, units, lessons, items int) string {
	var b strings.Builder
	b.WriteString("Tu es un concepteur pédagogique pour une application d'apprentissage des langues type Duolingo.\n")
	fmt.Fprintf(&b, "Tu produis un cours pour apprendre la langue cible %q (%s), niveau débutant (A1→A2).\n", target, targetLangName[target])
	b.WriteString("Réponds STRICTEMENT par un objet JSON valide, sans texte autour, sans bloc de code Markdown.\n\n")
	b.WriteString("Schéma attendu :\n")
	b.WriteString(`{
  "title": "<autonyme de la langue cible>",
  "units": [
    {
      "slug": "<kebab-case stable, ex. 'basics'>",
      "title": "<titre court de l'unité, dans la langue cible>",
      "lessons": [
        {
          "slug": "<kebab-case stable, ex. 'greetings'>",
          "title": "<titre court de la leçon, dans la langue cible>",
          "xp": 10,
          "items": [
            {
              "target": "<mot ou phrase courte DANS LA LANGUE CIBLE>",
              "tr": { <traduction du sens dans CHAQUE langue source> }
            }
          ]
        }
      ]
    }
  ]
}` + "\n\n")
	fmt.Fprintf(&b, "Contraintes : %d unités, %d leçons par unité, %d items par leçon.\n", units, lessons, items)
	fmt.Fprintf(&b, "Le champ \"tr\" DOIT contenir EXACTEMENT ces clés de langue source : %s.\n", strings.Join(sources, ", "))
	b.WriteString("Les slugs doivent être stables et uniques au sein de leur parent (ils servent de clé d'upsert).\n")
	b.WriteString("Progression pédagogique croissante : vocabulaire et structures du plus simple au plus complexe.\n")
	b.WriteString("Pas de doublon d'item. Mots/phrases utiles et courants. Aucune translittération dans \"target\" : écris dans le script natif de la langue cible.\n")
	return b.String()
}

// parseCourseJSON : extrait l'objet JSON de la réponse (tolère un éventuel
// bloc de code Markdown ou du texte avant/après).
func parseCourseJSON(raw string) (Course, error) {
	s := strings.TrimSpace(raw)
	// Retire un éventuel fence ```json ... ```.
	if i := strings.Index(s, "```"); i >= 0 {
		s = s[i+3:]
		s = strings.TrimPrefix(s, "json")
		if j := strings.LastIndex(s, "```"); j >= 0 {
			s = s[:j]
		}
	}
	// Borne à l'objet { ... } le plus externe.
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start < 0 || end <= start {
		return Course{}, fmt.Errorf("learn: réponse Claude sans JSON exploitable")
	}
	s = s[start : end+1]
	var c Course
	if err := json.Unmarshal([]byte(s), &c); err != nil {
		return Course{}, fmt.Errorf("learn: JSON cours invalide: %w", err)
	}
	return c, nil
}

// validateCourse : garde-fous avant persistance (slugs, langues, traductions).
func validateCourse(c Course, target string, sources []string) error {
	if len(c.Units) == 0 {
		return fmt.Errorf("learn: cours sans unité")
	}
	seenUnit := map[string]bool{}
	for _, u := range c.Units {
		if u.Slug == "" {
			return fmt.Errorf("learn: unité sans slug")
		}
		if seenUnit[u.Slug] {
			return fmt.Errorf("learn: slug d'unité dupliqué: %q", u.Slug)
		}
		seenUnit[u.Slug] = true
		if len(u.Lessons) == 0 {
			return fmt.Errorf("learn: unité %q sans leçon", u.Slug)
		}
		seenLesson := map[string]bool{}
		for _, l := range u.Lessons {
			if l.Slug == "" {
				return fmt.Errorf("learn: leçon sans slug (unité %q)", u.Slug)
			}
			if seenLesson[l.Slug] {
				return fmt.Errorf("learn: slug de leçon dupliqué: %q", l.Slug)
			}
			seenLesson[l.Slug] = true
			if len(l.Items) == 0 {
				return fmt.Errorf("learn: leçon %q sans item", l.Slug)
			}
			for _, it := range l.Items {
				if strings.TrimSpace(it.Target) == "" {
					return fmt.Errorf("learn: item sans target (leçon %q)", l.Slug)
				}
				// Leçon d'écriture : le « sens » est la prononciation universelle
				// (Sound), pas une traduction par langue source. On valide Sound
				// et on saute les contrôles de traduction.
				if l.Kind == LessonKindScript {
					if strings.TrimSpace(it.Sound) == "" {
						return fmt.Errorf("learn: item script %q sans sound (leçon %q)", it.Target, l.Slug)
					}
					continue
				}
				for _, src := range sources {
					if strings.TrimSpace(it.Tr[src]) == "" {
						return fmt.Errorf("learn: item %q sans traduction %q", it.Target, src)
					}
				}
			}
		}
	}
	return nil
}
