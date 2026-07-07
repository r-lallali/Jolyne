package vocab

import (
	"testing"
	"time"
)

func TestNextReview(t *testing.T) {
	now := time.Date(2026, 7, 6, 12, 0, 0, 0, time.UTC)
	fresh := SRSState{Ease: 2.5}

	t.Run("good progression 1j puis 6j puis ease", func(t *testing.T) {
		s, due := NextReview(fresh, GradeGood, now)
		if s.IntervalDays != 1 || !due.Equal(now.Add(24*time.Hour)) {
			t.Fatalf("1st good: %+v due=%v", s, due)
		}
		s, due = NextReview(s, GradeGood, now)
		if s.IntervalDays != 6 {
			t.Fatalf("2nd good: %+v", s)
		}
		s, _ = NextReview(s, GradeGood, now)
		if s.IntervalDays != 15 { // 6 × 2.5
			t.Fatalf("3rd good: %+v", s)
		}
		_ = due
	})

	t.Run("again resets reps, penalizes ease, due in 10min", func(t *testing.T) {
		s := SRSState{Ease: 2.5, IntervalDays: 15, Reps: 3}
		s, due := NextReview(s, GradeAgain, now)
		if s.Reps != 0 || s.Lapses != 1 || s.IntervalDays != 0 {
			t.Fatalf("again: %+v", s)
		}
		if s.Ease != 2.3 {
			t.Fatalf("ease: %v", s.Ease)
		}
		if !due.Equal(now.Add(10 * time.Minute)) {
			t.Fatalf("due: %v", due)
		}
	})

	t.Run("ease clamped at floor", func(t *testing.T) {
		s := SRSState{Ease: 1.35}
		s, _ = NextReview(s, GradeAgain, now)
		if s.Ease != 1.3 {
			t.Fatalf("ease floor: %v", s.Ease)
		}
	})

	t.Run("hard grows slowly from zero", func(t *testing.T) {
		s, due := NextReview(fresh, GradeHard, now)
		if s.IntervalDays != 1 {
			t.Fatalf("hard: %+v", s)
		}
		if !due.Equal(now.Add(24 * time.Hour)) {
			t.Fatalf("due: %v", due)
		}
	})

	t.Run("easy first review is 4 days with ease bonus", func(t *testing.T) {
		s, _ := NextReview(fresh, GradeEasy, now)
		if s.IntervalDays != 4 || s.Ease != 2.65 {
			t.Fatalf("easy: %+v", s)
		}
	})

	t.Run("zero ease defaults to 2.5", func(t *testing.T) {
		s, _ := NextReview(SRSState{}, GradeGood, now)
		if s.Ease != 2.5 {
			t.Fatalf("default ease: %v", s.Ease)
		}
	})
}

func TestValidGrade(t *testing.T) {
	for _, g := range []Grade{GradeAgain, GradeHard, GradeGood, GradeEasy} {
		if !ValidGrade(g) {
			t.Fatalf("%s should be valid", g)
		}
	}
	if ValidGrade("perfect") {
		t.Fatal("unknown grade accepted")
	}
}
