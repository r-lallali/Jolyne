package moderation

import "testing"

func TestParseVerdict(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		wantTox bool
		wantSev int
		wantCat string
	}{
		{
			name:    "clean",
			raw:     `{"toxic": false, "category": "none", "severity": 0}`,
			wantTox: false, wantSev: 0, wantCat: "none",
		},
		{
			name:    "toxic wrapped in prose",
			raw:     "Voici le verdict : {\"toxic\": true, \"category\": \"harassment\", \"severity\": 2} fin",
			wantTox: true, wantSev: 2, wantCat: "harassment",
		},
		{
			name:    "severity implies toxic even if flag false",
			raw:     `{"toxic": false, "category": "hate", "severity": 3}`,
			wantTox: true, wantSev: 3, wantCat: "hate",
		},
		{
			name:    "severity clamped above range",
			raw:     `{"toxic": true, "category": "threat", "severity": 9}`,
			wantTox: true, wantSev: 3, wantCat: "threat",
		},
		{
			name:    "garbage falls back to clean",
			raw:     "je ne peux pas répondre",
			wantTox: false, wantSev: 0, wantCat: "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			v := parseVerdict(tt.raw)
			if v.Toxic != tt.wantTox || v.Severity != tt.wantSev || v.Category != tt.wantCat {
				t.Fatalf("parseVerdict(%q) = %+v, want toxic=%v sev=%d cat=%q",
					tt.raw, v, tt.wantTox, tt.wantSev, tt.wantCat)
			}
		})
	}
}
