// Package learn : mode Cours (apprentissage type Duolingo). Sépare le CONTENU
// pédagogique (cours → unités → leçons, partagé et regénérable) de la
// PROGRESSION par utilisateur (XP, streak quotidien obligatoire, cœurs, succès).
//
// Parti pris : une leçon porte ses « items » (mot/phrase cible + traductions
// par langue source). Le lecteur de leçon côté front dérive les exercices
// (choisir / traduire / associer) de ces items dans la langue de l'apprenant.
// On ne stocke donc ni exercices ni distracteurs par langue — juste la matière.
package learn

import "time"

// SupportedLangs : langues acceptées comme cible de cours ET comme langue
// source d'un apprenant. Aligné sur l'i18n front et le handler translate.
var SupportedLangs = map[string]struct{}{
	"fr": {}, "en": {}, "es": {}, "de": {}, "pt": {}, "it": {},
	"zh": {}, "ja": {}, "ko": {}, "ar": {},
}

func IsSupportedLang(code string) bool {
	_, ok := SupportedLangs[code]
	return ok
}

// ----- Contenu (entrée du seed / sortie du générateur Claude) -----

// Item : une brique pédagogique. `Target` est dans la langue cible du cours ;
// `Tr` mappe chaque langue source vers la traduction (sens) du terme.
//
// Items « script » (apprentissage du système d'écriture) : `Target` porte le
// signe (kana, jamo, lettre arabe, caractère), `Tr` est inutile (le « sens »
// d'un signe est sa prononciation, universelle → `Sound`). Champs spécifiques
// optionnels ci-dessous, ignorés par les leçons de vocabulaire.
type Item struct {
	Target string            `json:"target"`
	Tr     map[string]string `json:"tr,omitempty"`
	Notes  string            `json:"notes,omitempty"`

	// ----- champs script (omitempty : absents des items de vocabulaire) -----
	// Sound : translittération/prononciation universelle (romaji, RR coréen,
	// pinyin…). Sert de « sens » pour dériver les exercices signe↔son.
	Sound string `json:"sound,omitempty"`
	// Forms : formes positionnelles arabes dans l'ordre
	// [isolée, initiale, médiane, finale]. Pour l'exercice de reconnaissance
	// de forme selon la position dans le mot.
	Forms []string `json:"forms,omitempty"`
	// Parts : composants ordonnés d'un bloc (jamo Hangul d'une syllabe). Pour
	// l'exercice de composition (assembler le bloc à partir des jamo).
	Parts []string `json:"parts,omitempty"`
	// Strokes : chemins SVG ordonnés (viewBox 0 0 100 100) pour animer l'ordre
	// des traits en guide de tracé. Optionnel (amélioration progressive).
	Strokes []string `json:"strokes,omitempty"`
	// Example / ExampleSound : mot illustrant le signe + sa lecture. Sert à
	// l'exercice de lecture (mot composé de signes appris → sa prononciation).
	Example      string `json:"example,omitempty"`
	ExampleSound string `json:"example_sound,omitempty"`
}

// LessonContent : forme stockée en JSONB sur learn_lessons.content.
type LessonContent struct {
	Items []Item `json:"items"`
}

// Course / Unit / Lesson : arbre complet servant à l'upsert (seed + générateur).
type Course struct {
	Lang  string `json:"lang"`
	Title string `json:"title"`
	Units []Unit `json:"units"`
}

type Unit struct {
	Slug    string   `json:"slug"`
	Title   string   `json:"title"`
	Lessons []Lesson `json:"lessons"`
}

type Lesson struct {
	Slug  string `json:"slug"`
	Title string `json:"title"`
	XP    int    `json:"xp"`
	// Kind : "vocab" (défaut) ou "script" (apprentissage de l'écriture). Pilote
	// le type d'exercices dérivés côté front.
	Kind  string `json:"kind,omitempty"`
	Items []Item `json:"items"`
}

// ----- Vues renvoyées au front -----

// CourseSummary : un cours disponible (pour la liste de sélection).
type CourseSummary struct {
	Lang        string `json:"lang"`
	Title       string `json:"title"`
	UnitCount   int    `json:"unit_count"`
	LessonCount int    `json:"lesson_count"`
}

// CourseTree : arbre d'un cours décoré de la progression du user. Les leçons
// portent leur ID DB (pour lancer la lecture) et leur statut (verrou/étoiles).
type CourseTree struct {
	Lang  string     `json:"lang"`
	Title string     `json:"title"`
	Units []UnitNode `json:"units"`
	// Enrolled : l'apprenant a déjà choisi son niveau de départ pour ce cours.
	// Si false, le front affiche d'abord le sélecteur de niveau.
	Enrolled  bool `json:"enrolled"`
	UnitCount int  `json:"unit_count"`
}

type UnitNode struct {
	Slug  string `json:"slug"`
	Title string `json:"title"`
	// Kind : "vocab" ou "script" (dérivé de la 1re leçon de l'unité). Le front
	// décore les unités d'écriture et calcule la frontière script→vocab pour le
	// diagnostic « je lis déjà ce script ».
	Kind    string       `json:"kind,omitempty"`
	Lessons []LessonNode `json:"lessons"`
}

type LessonNode struct {
	ID        int64  `json:"id"`
	Slug      string `json:"slug"`
	Title     string `json:"title"`
	Kind      string `json:"kind,omitempty"`
	XP        int    `json:"xp"`
	ItemCount int    `json:"item_count"`
	Stars     int    `json:"stars"`
	Completed bool   `json:"completed"`
	Locked    bool   `json:"locked"`
	// Placed : leçon acquise via le choix de niveau (non jouée). Affichée
	// comme faite mais sans étoiles, et jouable en révision.
	Placed bool `json:"placed"`
}

// PlayItem : item résolu dans la langue de l'apprenant pour la lecture. Pour
// les leçons script, `Meaning` reprend `Sound` (universel) et les champs
// d'écriture sont propagés pour dériver les exercices côté front.
type PlayItem struct {
	Target  string `json:"target"`
	Meaning string `json:"meaning"`
	// ----- champs script (omitempty) -----
	Sound        string   `json:"sound,omitempty"`
	Forms        []string `json:"forms,omitempty"`
	Parts        []string `json:"parts,omitempty"`
	Strokes      []string `json:"strokes,omitempty"`
	Example      string   `json:"example,omitempty"`
	ExampleSound string   `json:"example_sound,omitempty"`
}

// LessonPlay : payload de lecture d'une leçon (items résolus + meta).
type LessonPlay struct {
	ID    int64      `json:"id"`
	Title string     `json:"title"`
	Kind  string     `json:"kind,omitempty"`
	XP    int        `json:"xp"`
	Items []PlayItem `json:"items"`
}

// State : état de gamification courant renvoyé au front.
type State struct {
	TotalXP        int      `json:"total_xp"`
	DailyGoal      int      `json:"daily_goal"`
	DailyXP        int      `json:"daily_xp"`
	Hearts         int      `json:"hearts"`
	MaxHearts      int      `json:"max_hearts"`
	NextHeartInSec int      `json:"next_heart_in_sec"`
	CurrentStreak  int      `json:"current_streak"`
	LongestStreak  int      `json:"longest_streak"`
	StreakAtRisk   bool     `json:"streak_at_risk"`
	Achievements   []string `json:"achievements"`
	// Premium : cœurs illimités (jamais décrémentés). Le front affiche un
	// cœur doré « ∞ » et masque l'upsell.
	Premium         bool `json:"premium"`
	UnlimitedHearts bool `json:"unlimited_hearts"`
	// CanAskHeart : l'apprenant peut encore demander un cœur à un ami
	// aujourd'hui (quota 1/jour non consommé).
	CanAskHeart bool `json:"can_ask_heart"`
	// IncomingHeartRequests : nombre de demandes de cœur en attente reçues
	// (à afficher en bannière pour les accorder).
	IncomingHeartRequests int `json:"incoming_heart_requests"`
}

// HeartRequest : demande de cœur reçue, présentée pour être accordée.
type HeartRequest struct {
	ID          int64  `json:"id"`
	RequesterID int64  `json:"requester_id"`
	CreatedAt   string `json:"created_at"`
}

// CompleteResult : résultat de la validation d'une leçon.
type CompleteResult struct {
	XPAwarded          int      `json:"xp_awarded"`
	Stars              int      `json:"stars"`
	State              State    `json:"state"`
	NewAchievements    []string `json:"new_achievements"`
	StreakIncreased    bool     `json:"streak_increased"`
	NewStreakMilestone int      `json:"new_streak_milestone"`
	// Failed : leçon échouée (plus de cœurs en cours de route). Les cœurs sont
	// décomptés mais aucun XP / progrès / streak n'est attribué.
	Failed bool `json:"failed"`
}

// ----- Constantes de gamification -----

const (
	MaxHearts   = 5
	HeartRegen  = 30 * time.Minute
	DefaultGoal = 20
	MinGoal     = 5
	MaxGoal     = 100
	ReviewXPMax = 5 // XP plafonné pour une leçon déjà complétée (anti-farm)
)

// StreakMilestones : paliers célébrés (popup). Même esprit que friends.
var StreakMilestones = []int{2, 3, 7, 14, 30, 50, 100, 365}

// AchievementKind : nature du seuil d'un succès.
type AchievementKind string

const (
	KindFirstLesson AchievementKind = "lessons"
	KindXP          AchievementKind = "xp"
	KindStreak      AchievementKind = "streak"
)

// AchievementDef : définition en dur d'un succès. Le `Code` est l'identité
// persistée ; le libellé est traduit côté front via l'i18n (clé = code).
type AchievementDef struct {
	Code      string
	Kind      AchievementKind
	Threshold int
}

// Achievements : catalogue. Évalué à chaque complétion de leçon.
var Achievements = []AchievementDef{
	{Code: "first_lesson", Kind: KindFirstLesson, Threshold: 1},
	{Code: "lessons_10", Kind: KindFirstLesson, Threshold: 10},
	{Code: "lessons_50", Kind: KindFirstLesson, Threshold: 50},
	{Code: "xp_100", Kind: KindXP, Threshold: 100},
	{Code: "xp_500", Kind: KindXP, Threshold: 500},
	{Code: "xp_1000", Kind: KindXP, Threshold: 1000},
	{Code: "streak_3", Kind: KindStreak, Threshold: 3},
	{Code: "streak_7", Kind: KindStreak, Threshold: 7},
	{Code: "streak_30", Kind: KindStreak, Threshold: 30},
}

// starsFromMistakes : 0 faute = 3 étoiles, 1-2 = 2, sinon 1.
func starsFromMistakes(mistakes int) int {
	switch {
	case mistakes <= 0:
		return 3
	case mistakes <= 2:
		return 2
	default:
		return 1
	}
}

// resolveMeaning : traduction d'un item dans la langue source `from`, avec
// repli sur l'anglais puis sur n'importe quelle traduction disponible.
func resolveMeaning(it Item, from string) string {
	if m, ok := it.Tr[from]; ok && m != "" {
		return m
	}
	if m, ok := it.Tr["en"]; ok && m != "" {
		return m
	}
	for _, m := range it.Tr {
		if m != "" {
			return m
		}
	}
	return ""
}
