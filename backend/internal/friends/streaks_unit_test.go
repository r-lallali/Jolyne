package friends

import (
	"sort"
	"testing"
	"time"
)

func TestDaysBetweenUTC(t *testing.T) {
	cases := []struct {
		name string
		a, b time.Time
		want int
	}{
		{"same-day", t0(2026, 3, 5, 1, 0), t0(2026, 3, 5, 23, 0), 0},
		{"one-day", t0(2026, 3, 4, 23, 0), t0(2026, 3, 5, 0, 30), 1},
		{"crosses-month", t0(2026, 2, 28, 12, 0), t0(2026, 3, 2, 12, 0), 2},
		{"crosses-year", t0(2025, 12, 31, 22, 0), t0(2026, 1, 1, 2, 0), 1},
		{"backwards-negative", t0(2026, 3, 6, 12, 0), t0(2026, 3, 5, 12, 0), -1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := daysBetweenUTC(tc.a, tc.b)
			if got != tc.want {
				t.Fatalf("daysBetweenUTC(%v, %v) = %d, want %d", tc.a, tc.b, got, tc.want)
			}
		})
	}
}

func TestDaysBetweenUTC_IgnoresTimeOfDay(t *testing.T) {
	// 23:59 → 00:01 lendemain = 1 jour, malgré 2 minutes réelles.
	a := time.Date(2026, 3, 5, 23, 59, 0, 0, time.UTC)
	b := time.Date(2026, 3, 6, 0, 1, 0, 0, time.UTC)
	if got := daysBetweenUTC(a, b); got != 1 {
		t.Fatalf("got %d, want 1", got)
	}
}

func TestMonthKeyUTC(t *testing.T) {
	cases := []struct {
		in   time.Time
		want string
	}{
		{t0(2026, 5, 27, 12, 0), "2026-05"},
		{t0(2026, 1, 1, 0, 0), "2026-01"},
		{t0(2025, 12, 31, 23, 59), "2025-12"},
	}
	for _, tc := range cases {
		t.Run(tc.want, func(t *testing.T) {
			if got := monthKeyUTC(tc.in); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestStreakMilestones_SortedAscending(t *testing.T) {
	if len(StreakMilestones) == 0 {
		t.Fatal("StreakMilestones doit être non vide")
	}
	cp := append([]int(nil), StreakMilestones...)
	sort.Ints(cp)
	for i := range cp {
		if cp[i] != StreakMilestones[i] {
			t.Fatalf("StreakMilestones doit être trié croissant: %v", StreakMilestones)
		}
	}
	// Le premier palier célèbre "premier streak établi" — c'est 2.
	if StreakMilestones[0] != 2 {
		t.Fatalf("premier palier doit être 2 (premier streak), got %d", StreakMilestones[0])
	}
}

func TestStreakMilestones_NoDuplicates(t *testing.T) {
	seen := map[int]bool{}
	for _, m := range StreakMilestones {
		if seen[m] {
			t.Fatalf("doublon: %d", m)
		}
		seen[m] = true
	}
}

func TestRestoreConstants(t *testing.T) {
	if RestoreWindow <= 0 {
		t.Fatalf("RestoreWindow doit être > 0, got %d", RestoreWindow)
	}
	if RestoreMonthlyQuota <= 0 {
		t.Fatalf("RestoreMonthlyQuota doit être > 0, got %d", RestoreMonthlyQuota)
	}
}

func t0(y int, mo time.Month, d, h, mi int) time.Time {
	return time.Date(y, mo, d, h, mi, 0, 0, time.UTC)
}
