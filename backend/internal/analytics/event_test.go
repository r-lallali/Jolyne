package analytics

import "testing"

func TestValidName(t *testing.T) {
	if !ValidName(EventSignupCompleted) {
		t.Fatalf("signup_completed devrait être valide")
	}
	if ValidName("not_a_real_event") {
		t.Fatalf("un nom hors allowlist ne doit pas être valide")
	}
}

func TestValidPublicName(t *testing.T) {
	if !ValidPublicName(EventPageView) {
		t.Fatalf("page_view doit être autorisé pour le beacon public")
	}
	// Un event serveur ne doit jamais être acceptable via le beacon public.
	if ValidPublicName(EventPremiumActivated) {
		t.Fatalf("premium_activated ne doit pas être émettable par le beacon public")
	}
}

func TestHashID(t *testing.T) {
	if HashID("") != "" {
		t.Fatalf("HashID(\"\") doit être vide")
	}
	if got := HashID("abc"); len(got) != 16 {
		t.Fatalf("HashID doit faire 16 chars hex, got %q (%d)", got, len(got))
	}
	if HashID("abc") != HashID("abc") {
		t.Fatalf("HashID doit être déterministe")
	}
}

func TestEmitNilSafe(t *testing.T) {
	// Un Tracker nil (Postgres absent) doit être un no-op, pas un panic.
	var tr *Tracker
	tr.Emit(Event{Name: EventLogin})
	tr.Close()
}
