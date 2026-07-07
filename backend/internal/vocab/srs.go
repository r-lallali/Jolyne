package vocab

import "time"

// SM-2 adapté (répétition espacée). Quatre notes utilisateur, calibrées sur
// l'usage Anki que les habitués connaissent :
//
//   again : oubli — l'entrée redevient due dans 10 minutes, reps repart à
//           zéro, l'ease prend une pénalité durable.
//   hard  : rappelé péniblement — intervalle ×1.2, ease légèrement pénalisé.
//   good  : rappelé — 1 jour, puis 6 jours, puis intervalle × ease.
//   easy  : trivial — comme good avec un bonus ×1.3 et un gain d'ease.
//
// L'état est volontairement compatible FSRS (mêmes colonnes de base) si on
// veut upgrader l'algo plus tard sans migration.

type Grade string

const (
	GradeAgain Grade = "again"
	GradeHard  Grade = "hard"
	GradeGood  Grade = "good"
	GradeEasy  Grade = "easy"
)

// ValidGrade : les seules notes acceptées par l'endpoint de révision.
func ValidGrade(g Grade) bool {
	switch g {
	case GradeAgain, GradeHard, GradeGood, GradeEasy:
		return true
	}
	return false
}

// Bornes de l'ease : sous 1.3 les intervalles stagnent (ease hell), au-delà
// de 3.5 les mots disparaissent des mois trop tôt.
const (
	easeMin = 1.3
	easeMax = 3.5
	// againDelay : une entrée oubliée revient dans la même session.
	againDelay = 10 * time.Minute
)

// SRSState : l'état de révision d'une entrée, tel que stocké en base.
type SRSState struct {
	Ease         float64
	IntervalDays float64
	Reps         int
	Lapses       int
}

// NextReview applique une note à un état et renvoie le nouvel état + la
// prochaine échéance. Fonction pure — testable sans DB.
func NextReview(s SRSState, g Grade, now time.Time) (SRSState, time.Time) {
	if s.Ease == 0 {
		s.Ease = 2.5
	}
	switch g {
	case GradeAgain:
		s.Lapses++
		s.Reps = 0
		s.IntervalDays = 0
		s.Ease = clampEase(s.Ease - 0.2)
		return s, now.Add(againDelay)
	case GradeHard:
		s.Reps++
		s.Ease = clampEase(s.Ease - 0.15)
		if s.IntervalDays < 1 {
			s.IntervalDays = 1
		} else {
			s.IntervalDays *= 1.2
		}
	case GradeGood:
		s.Reps++
		switch s.Reps {
		case 1:
			s.IntervalDays = 1
		case 2:
			s.IntervalDays = 6
		default:
			s.IntervalDays *= s.Ease
		}
	case GradeEasy:
		s.Reps++
		s.Ease = clampEase(s.Ease + 0.15)
		if s.Reps == 1 {
			s.IntervalDays = 4
		} else if s.IntervalDays < 6 {
			s.IntervalDays = 6
		} else {
			s.IntervalDays *= s.Ease * 1.3
		}
	}
	return s, now.Add(time.Duration(s.IntervalDays * float64(24*time.Hour)))
}

func clampEase(e float64) float64 {
	if e < easeMin {
		return easeMin
	}
	if e > easeMax {
		return easeMax
	}
	return e
}
