package learn

import (
	"testing"
	"time"
)

func TestApplyStreak(t *testing.T) {
	now := time.Date(2026, 7, 6, 12, 0, 0, 0, time.UTC)
	yesterday := now.Add(-24 * time.Hour)
	lastWeek := now.Add(-7 * 24 * time.Hour)

	t.Run("first activity starts at 1", func(t *testing.T) {
		r := applyStreak(0, 0, nil, 0, now)
		if r.Streak != 1 || !r.Increased || r.Reset {
			t.Fatalf("got %+v", r)
		}
	})

	t.Run("same day keeps streak", func(t *testing.T) {
		r := applyStreak(5, 5, &now, 3, now)
		if r.Streak != 5 || r.Increased {
			t.Fatalf("got %+v", r)
		}
	})

	t.Run("next day increments and longest follows", func(t *testing.T) {
		r := applyStreak(5, 5, &yesterday, 3, now)
		if r.Streak != 6 || r.Longest != 6 || !r.Increased {
			t.Fatalf("got %+v", r)
		}
	})

	t.Run("gap resets to 1 and rearms milestones", func(t *testing.T) {
		r := applyStreak(30, 30, &lastWeek, 30, now)
		if r.Streak != 1 || !r.Reset || r.Longest != 30 {
			t.Fatalf("got %+v", r)
		}
		if r.PersistedMilestone != 0 {
			t.Fatalf("milestone should rearm after reset, got %d", r.PersistedMilestone)
		}
	})

	t.Run("milestone crossed exactly once", func(t *testing.T) {
		r := applyStreak(6, 6, &yesterday, 3, now)
		if r.Streak != 7 || r.NewMilestone != 7 || r.PersistedMilestone != 7 {
			t.Fatalf("got %+v", r)
		}
		// Rejouer le lendemain sans franchir de palier : rien de nouveau.
		r2 := applyStreak(r.Streak, r.Longest, &yesterday, r.PersistedMilestone, now)
		if r2.NewMilestone != 0 {
			t.Fatalf("milestone re-fired: %+v", r2)
		}
	})
}
