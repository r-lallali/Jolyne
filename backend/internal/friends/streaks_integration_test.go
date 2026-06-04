//go:build integration

package friends_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ralys/jolyne/backend/internal/db"
	"github.com/ralys/jolyne/backend/internal/friends"
)

// dsn renvoie le DSN postgres de test — surchargeable via env. Identique
// au pattern de internal/db/db_integration_test.go.
func dsn(t *testing.T) string {
	t.Helper()
	v := os.Getenv("TEST_POSTGRES_DSN")
	if v == "" {
		v = "postgres://jolyne:jolyne@127.0.0.1:5432/jolyne?sslmode=disable"
	}
	return v
}

// newPool ouvre la connexion, applique les migrations et nettoie les
// tables touchées par le test. Skippe si Postgres indispo.
func newPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	d := dsn(t)
	pool, err := db.New(context.Background(), d)
	if err != nil {
		t.Skipf("postgres indisponible: %v", err)
	}
	if err := db.RunMigrations(d); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() {
		// CASCADE supprime friend_streaks, friend_messages.
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM friends WHERE user_a_id IN (
			    SELECT id FROM users WHERE email LIKE '%@streaktest.local')`)
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM users WHERE email LIKE '%@streaktest.local'`)
		pool.Close()
	})
	return pool
}

// makeUser : crée un user de test avec un email aléatoire. Renvoie l'ID.
func makeUser(t *testing.T, pool *pgxpool.Pool, suffix string) int64 {
	t.Helper()
	email := fmt.Sprintf("user-%d-%s@streaktest.local", time.Now().UnixNano(), suffix)
	var id int64
	err := pool.QueryRow(context.Background(),
		`INSERT INTO users (email) VALUES ($1) RETURNING id`, email,
	).Scan(&id)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	return id
}

// makeFriend : crée une amitié entre uA et uB, renvoie le friend_id.
func makeFriend(t *testing.T, store *friends.Store, uA, uB int64) int64 {
	t.Helper()
	f, err := store.Add(context.Background(), uA, uB)
	if err != nil {
		t.Fatalf("add friend: %v", err)
	}
	return f.ID
}

// readStreakRow : lit l'état brut de friend_streaks pour assertions.
func readStreakRow(t *testing.T, pool *pgxpool.Pool, fid int64) (current int, lastDay *time.Time) {
	t.Helper()
	err := pool.QueryRow(context.Background(),
		`SELECT current_streak, last_streak_day FROM friend_streaks WHERE friend_id = $1`, fid,
	).Scan(&current, &lastDay)
	if err != nil {
		t.Fatalf("read streak: %v", err)
	}
	return
}

func TestStreak_FirstDay_NoBumpUntilBothWrite(t *testing.T) {
	pool := newPool(t)
	store := friends.NewStore(pool)
	uA := makeUser(t, pool, "a")
	uB := makeUser(t, pool, "b")
	fid := makeFriend(t, store, uA, uB)

	// A écrit en premier — pas encore bilatéral, streak reste 0.
	_, st, err := store.AppendMessageWithStreak(context.Background(), fid, uA, "salut")
	if err != nil {
		t.Fatalf("append A: %v", err)
	}
	if st.Current != 0 {
		t.Fatalf("A seul: current devrait être 0, got %d", st.Current)
	}

	// B répond — devient bilatéral aujourd'hui, current = 1.
	_, st, err = store.AppendMessageWithStreak(context.Background(), fid, uB, "yo")
	if err != nil {
		t.Fatalf("append B: %v", err)
	}
	if st.Current != 1 {
		t.Fatalf("après réponse B: current = 1 attendu, got %d", st.Current)
	}
	if st.AtRisk {
		t.Fatal("AtRisk doit être false quand les deux écrivent aujourd'hui")
	}
}

func TestStreak_SameDay_NoDoubleBump(t *testing.T) {
	pool := newPool(t)
	store := friends.NewStore(pool)
	uA := makeUser(t, pool, "a")
	uB := makeUser(t, pool, "b")
	fid := makeFriend(t, store, uA, uB)

	_, _, _ = store.AppendMessageWithStreak(context.Background(), fid, uA, "1")
	_, st, _ := store.AppendMessageWithStreak(context.Background(), fid, uB, "2")
	if st.Current != 1 {
		t.Fatalf("init streak = 1 attendu, got %d", st.Current)
	}
	// A renvoie 3 messages le même jour — streak reste à 1.
	for i := 0; i < 3; i++ {
		_, st, _ = store.AppendMessageWithStreak(context.Background(), fid, uA, "again")
	}
	if st.Current != 1 {
		t.Fatalf("same day: streak doit rester 1, got %d", st.Current)
	}
}

func TestStreak_Milestone_FiredOnce(t *testing.T) {
	pool := newPool(t)
	store := friends.NewStore(pool)
	uA := makeUser(t, pool, "a")
	uB := makeUser(t, pool, "b")
	fid := makeFriend(t, store, uA, uB)

	// Simule un streak en place à valeur seuil 2 : on écrit côté A puis B.
	_, _, _ = store.AppendMessageWithStreak(context.Background(), fid, uA, "x")
	_, st, _ := store.AppendMessageWithStreak(context.Background(), fid, uB, "y")
	if st.Current != 1 {
		t.Fatalf("init: %d", st.Current)
	}
	if st.NewMilestone != 0 {
		t.Fatalf("pas de milestone à 1, got %d", st.NewMilestone)
	}
	// Force last_streak_day = hier pour simuler la bascule jour.
	if _, err := pool.Exec(context.Background(),
		`UPDATE friend_streaks
		 SET last_streak_day = (now() AT TIME ZONE 'UTC')::date - 1,
		     last_a_msg_day  = (now() AT TIME ZONE 'UTC')::date - 1,
		     last_b_msg_day  = (now() AT TIME ZONE 'UTC')::date - 1
		 WHERE friend_id = $1`, fid); err != nil {
		t.Fatalf("backdate: %v", err)
	}
	// A puis B aujourd'hui → streak passe à 2 → milestone 2 déclenché.
	_, _, _ = store.AppendMessageWithStreak(context.Background(), fid, uA, "today")
	_, st, _ = store.AppendMessageWithStreak(context.Background(), fid, uB, "today")
	if st.Current != 2 {
		t.Fatalf("après bascule jour: streak = 2 attendu, got %d", st.Current)
	}
	if st.NewMilestone != 2 {
		t.Fatalf("milestone 2 attendu, got %d", st.NewMilestone)
	}

	// Replay du même jour : milestone NE DOIT PAS se redéclencher.
	_, st, _ = store.AppendMessageWithStreak(context.Background(), fid, uA, "again")
	if st.NewMilestone != 0 {
		t.Fatalf("milestone ne doit pas se redéclencher: got %d", st.NewMilestone)
	}
}

func TestStreak_LostAfterGapAndRestore(t *testing.T) {
	pool := newPool(t)
	store := friends.NewStore(pool)
	uA := makeUser(t, pool, "a")
	uB := makeUser(t, pool, "b")
	fid := makeFriend(t, store, uA, uB)

	// Construit un streak = 3 en backdate-ant directement la ligne.
	_, _, _ = store.AppendMessageWithStreak(context.Background(), fid, uA, "x")
	_, _, _ = store.AppendMessageWithStreak(context.Background(), fid, uB, "y")
	if _, err := pool.Exec(context.Background(),
		`UPDATE friend_streaks
		 SET current_streak = 3, last_streak_day = (now() AT TIME ZONE 'UTC')::date - 3
		 WHERE friend_id = $1`, fid); err != nil {
		t.Fatalf("seed lost: %v", err)
	}

	// Restauration unilatérale : un seul ami suffit, le streak repart
	// immédiatement sans attendre l'autre.
	res, err := store.RestoreStreak(context.Background(), fid, uA, time.Now())
	if err != nil {
		t.Fatalf("restore A: %v", err)
	}
	if !res.Restored {
		t.Fatalf("restore unilatéral attendu, got %+v", res)
	}
	if res.ErrCode != "" {
		t.Fatalf("err inattendu: %q", res.ErrCode)
	}
	if res.NewStreak != 3 {
		t.Fatalf("NewStreak = 3 attendu, got %d", res.NewStreak)
	}
	// L'initiateur a consommé 1 de ses 3 jetons mensuels.
	if res.RemainingThisMonth != friends.RestoreMonthlyQuota-1 {
		t.Fatalf("remaining = %d attendu, got %d", friends.RestoreMonthlyQuota-1, res.RemainingThisMonth)
	}

	cur, _ := readStreakRow(t, pool, fid)
	if cur != 3 {
		t.Fatalf("DB current_streak = 3 attendu, got %d", cur)
	}
}

func TestStreak_RestoreNoLoss(t *testing.T) {
	pool := newPool(t)
	store := friends.NewStore(pool)
	uA := makeUser(t, pool, "a")
	uB := makeUser(t, pool, "b")
	fid := makeFriend(t, store, uA, uB)

	// Streak intact (juste créé) → restore doit renvoyer "no_loss".
	_, _, _ = store.AppendMessageWithStreak(context.Background(), fid, uA, "x")
	_, _, _ = store.AppendMessageWithStreak(context.Background(), fid, uB, "y")

	res, err := store.RestoreStreak(context.Background(), fid, uA, time.Now())
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if res.ErrCode != "no_loss" {
		t.Fatalf("err_code = no_loss attendu, got %q", res.ErrCode)
	}
}

func TestStreak_RestoreWindowExpired(t *testing.T) {
	pool := newPool(t)
	store := friends.NewStore(pool)
	uA := makeUser(t, pool, "a")
	uB := makeUser(t, pool, "b")
	fid := makeFriend(t, store, uA, uB)

	_, _, _ = store.AppendMessageWithStreak(context.Background(), fid, uA, "x")
	_, _, _ = store.AppendMessageWithStreak(context.Background(), fid, uB, "y")
	// Streak perdu il y a 10 jours (> RestoreWindow = 7).
	if _, err := pool.Exec(context.Background(),
		`UPDATE friend_streaks
		 SET current_streak = 0, lost_streak = 5,
		     lost_at = (now() AT TIME ZONE 'UTC')::date - 10
		 WHERE friend_id = $1`, fid); err != nil {
		t.Fatalf("seed: %v", err)
	}

	res, err := store.RestoreStreak(context.Background(), fid, uA, time.Now())
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if res.ErrCode != "window_expired" {
		t.Fatalf("err_code = window_expired attendu, got %q", res.ErrCode)
	}
}

// seedLostStreak repositionne un streak perdu restaurable (≥ 2, daté d'il y a
// 3 jours) pour pouvoir enchaîner plusieurs restaurations dans un même test.
func seedLostStreak(t *testing.T, pool *pgxpool.Pool, fid int64, value int) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE friend_streaks
		 SET current_streak = $2,
		     last_streak_day = (now() AT TIME ZONE 'UTC')::date - 3,
		     lost_streak = NULL, lost_at = NULL
		 WHERE friend_id = $1`, fid, value); err != nil {
		t.Fatalf("seed lost streak: %v", err)
	}
}

// TestStreak_RestoreSharedQuotaPerConversation : le quota de 3/mois est
// PARTAGÉ par conversation — peu importe lequel des deux amis restaure, le
// même compteur est consommé, et la 4e tentative est refusée.
func TestStreak_RestoreSharedQuotaPerConversation(t *testing.T) {
	pool := newPool(t)
	store := friends.NewStore(pool)
	uA := makeUser(t, pool, "a")
	uB := makeUser(t, pool, "b")
	fid := makeFriend(t, store, uA, uB)

	// Crée la ligne friend_streaks.
	_, _, _ = store.AppendMessageWithStreak(context.Background(), fid, uA, "x")
	_, _, _ = store.AppendMessageWithStreak(context.Background(), fid, uB, "y")

	// 3 restaurations, alternées A/B/A : elles puisent dans le même compteur.
	for i, caller := range []int64{uA, uB, uA} {
		seedLostStreak(t, pool, fid, 4)
		res, err := store.RestoreStreak(context.Background(), fid, caller, time.Now())
		if err != nil {
			t.Fatalf("restore %d: %v", i+1, err)
		}
		if !res.Restored {
			t.Fatalf("restore %d devrait réussir: %+v", i+1, res)
		}
		if want := friends.RestoreMonthlyQuota - (i + 1); res.RemainingThisMonth != want {
			t.Fatalf("restore %d: remaining = %d attendu, got %d", i+1, want, res.RemainingThisMonth)
		}
	}

	// 4e tentative (par B) → quota de la conversation épuisé.
	seedLostStreak(t, pool, fid, 4)
	res, err := store.RestoreStreak(context.Background(), fid, uB, time.Now())
	if err != nil {
		t.Fatalf("restore 4: %v", err)
	}
	if res.Restored || res.ErrCode != "quota_exhausted" {
		t.Fatalf("4e restauration: quota_exhausted attendu, got %+v", res)
	}
}
