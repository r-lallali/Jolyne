package users

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"log/slog"
	"math/big"
	"net/url"
	"strings"
	"testing"
	"time"
)

// genAppleKeyPEM : clé ECDSA P-256 fraîche au format PKCS#8 PEM (même forme
// que le .p8 téléchargé de la console Apple).
func genAppleKeyPEM(t *testing.T) (string, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("genkey: %v", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("pkcs8: %v", err)
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
	return string(pemBytes), key
}

func TestAppleClientSecret(t *testing.T) {
	pemStr, key := genAppleKeyPEM(t)
	parsed, err := parseAppleP8(pemStr)
	if err != nil {
		t.Fatalf("parseAppleP8: %v", err)
	}
	now := time.Unix(1_750_000_000, 0)
	jwt, err := appleClientSecret("TEAM123", "KEY456", "ovh.ralys.jolyne", parsed, now)
	if err != nil {
		t.Fatalf("appleClientSecret: %v", err)
	}
	parts := strings.Split(jwt, ".")
	if len(parts) != 3 {
		t.Fatalf("jwt: %d segments, attendu 3", len(parts))
	}

	// Header + claims conformes.
	headerJSON, _ := base64.RawURLEncoding.DecodeString(parts[0])
	var header map[string]string
	if err := json.Unmarshal(headerJSON, &header); err != nil {
		t.Fatalf("header json: %v", err)
	}
	if header["alg"] != "ES256" || header["kid"] != "KEY456" {
		t.Errorf("header inattendu: %v", header)
	}
	claimsJSON, _ := base64.RawURLEncoding.DecodeString(parts[1])
	var claims map[string]any
	if err := json.Unmarshal(claimsJSON, &claims); err != nil {
		t.Fatalf("claims json: %v", err)
	}
	if claims["iss"] != "TEAM123" || claims["sub"] != "ovh.ralys.jolyne" ||
		claims["aud"] != "https://appleid.apple.com" {
		t.Errorf("claims inattendus: %v", claims)
	}
	if exp := int64(claims["exp"].(float64)); exp != now.Add(appleSecretTTL).Unix() {
		t.Errorf("exp = %d", exp)
	}

	// Signature ES256 (R||S brut) vérifiable avec la clé publique.
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || len(sig) != 64 {
		t.Fatalf("signature: len=%d err=%v", len(sig), err)
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	r := new(big.Int).SetBytes(sig[:32])
	s := new(big.Int).SetBytes(sig[32:])
	if !ecdsa.Verify(&key.PublicKey, digest[:], r, s) {
		t.Error("signature ES256 invalide")
	}
}

func TestParseAppleP8LiteralNewlines(t *testing.T) {
	pemStr, _ := genAppleKeyPEM(t)
	// Simule le collage une-ligne dans une UI d'env vars (\n littéraux).
	flat := strings.ReplaceAll(pemStr, "\n", `\n`)
	if _, err := parseAppleP8(flat); err != nil {
		t.Errorf("parseAppleP8 avec \\n littéraux: %v", err)
	}
}

func TestParseAppleP8Invalid(t *testing.T) {
	if _, err := parseAppleP8("pas un pem"); err == nil {
		t.Error("PEM invalide accepté")
	}
}

// makeIDToken : JWT non signé (signature bidon) — parseIDToken ne lit que le
// payload, la validation de signature étant déléguée au canal TLS.
func makeIDToken(t *testing.T, claims map[string]any) string {
	t.Helper()
	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatalf("marshal claims: %v", err)
	}
	b64 := base64.RawURLEncoding.EncodeToString
	return b64([]byte(`{"alg":"none"}`)) + "." + b64(payload) + "." + b64([]byte("sig"))
}

func TestParseIDTokenAndValidate(t *testing.T) {
	future := time.Now().Add(time.Hour).Unix()
	base := func() map[string]any {
		return map[string]any{
			"iss": "https://accounts.google.com", "aud": "client-1",
			"exp": future, "sub": "sub-1",
			"email": "a@b.c", "email_verified": true, "given_name": "Ada",
		}
	}
	issuers := []string{"https://accounts.google.com", "accounts.google.com"}

	claims, err := parseIDToken(makeIDToken(t, base()))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if err := claims.validate(issuers, "client-1", time.Now()); err != nil {
		t.Fatalf("validate: %v", err)
	}
	if claims.Sub != "sub-1" || claims.Email != "a@b.c" || !bool(claims.EmailVerified) {
		t.Errorf("claims inattendus: %+v", claims)
	}
	if claims.displayName() != "Ada" {
		t.Errorf("displayName = %q", claims.displayName())
	}

	cases := []struct {
		name   string
		mutate func(m map[string]any)
	}{
		{"iss inconnu", func(m map[string]any) { m["iss"] = "https://evil.example" }},
		{"aud inconnu", func(m map[string]any) { m["aud"] = "autre-client" }},
		{"expiré", func(m map[string]any) { m["exp"] = time.Now().Add(-time.Minute).Unix() }},
		{"sub vide", func(m map[string]any) { m["sub"] = "" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := base()
			tc.mutate(m)
			claims, err := parseIDToken(makeIDToken(t, m))
			if err != nil {
				t.Fatalf("parse: %v", err)
			}
			if err := claims.validate(issuers, "client-1", time.Now()); err == nil {
				t.Error("validation passée, rejet attendu")
			}
		})
	}
}

func TestParseIDTokenFlexClaims(t *testing.T) {
	// aud en tableau (autorisé par la spec JWT) + email_verified en string
	// (variante Apple historique).
	tok := makeIDToken(t, map[string]any{
		"iss": "https://appleid.apple.com", "aud": []string{"x", "client-1"},
		"exp": time.Now().Add(time.Hour).Unix(), "sub": "s",
		"email": "a@b.c", "email_verified": "true",
	})
	claims, err := parseIDToken(tok)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if err := claims.validate([]string{"https://appleid.apple.com"}, "client-1", time.Now()); err != nil {
		t.Errorf("validate: %v", err)
	}
	if !bool(claims.EmailVerified) {
		t.Error("email_verified \"true\" (string) non reconnu")
	}
	// Variante "false" string.
	tok = makeIDToken(t, map[string]any{"email_verified": "false"})
	claims, _ = parseIDToken(tok)
	if bool(claims.EmailVerified) {
		t.Error("email_verified \"false\" (string) lu comme vrai")
	}
}

func TestParseIDTokenMalformed(t *testing.T) {
	for _, raw := range []string{"", "abc", "a.b", "a.%%%.c"} {
		if _, err := parseIDToken(raw); err == nil {
			t.Errorf("token %q accepté", raw)
		}
	}
}

func TestAuthorizeURL(t *testing.T) {
	p := newGoogleProvider("cid", "secret", "https://api.example/api/auth/oauth/google/callback")
	u, err := url.Parse(p.authorizeURL("state-1"))
	if err != nil {
		t.Fatalf("url: %v", err)
	}
	q := u.Query()
	if q.Get("client_id") != "cid" || q.Get("state") != "state-1" ||
		q.Get("response_type") != "code" || q.Get("prompt") != "select_account" ||
		q.Get("redirect_uri") != "https://api.example/api/auth/oauth/google/callback" {
		t.Errorf("query inattendue: %v", q)
	}
	if !strings.Contains(q.Get("scope"), "email") {
		t.Errorf("scope: %q", q.Get("scope"))
	}
}

func TestNewOAuthProviderSelection(t *testing.T) {
	log := slog.Default()
	// Pas d'API base → désactivé même avec un provider complet.
	if o := NewOAuth(nil, OAuthConfig{GoogleClientID: "a", GoogleClientSecret: "b"}, log); o != nil {
		t.Error("OAuth actif sans APIBaseURL")
	}
	// Google seul.
	o := NewOAuth(nil, OAuthConfig{
		APIBaseURL: "https://api.example", GoogleClientID: "a", GoogleClientSecret: "b",
	}, log)
	if o == nil || len(o.names) != 1 || o.names[0] != "google" {
		t.Fatalf("names = %v", o)
	}
	if got := o.providers["google"].redirectURI; got != "https://api.example/api/auth/oauth/google/callback" {
		t.Errorf("redirectURI = %q", got)
	}
	// Apple avec clé invalide → ignoré, pas de panique.
	o = NewOAuth(nil, OAuthConfig{
		APIBaseURL: "https://api.example", AppleClientID: "c", AppleTeamID: "t",
		AppleKeyID: "k", ApplePrivateKey: "pas un pem",
	}, log)
	if o != nil {
		t.Error("OAuth actif avec seule une clé Apple invalide")
	}
}

func TestOAuthDisplayName(t *testing.T) {
	// Priorité aux claims (Google).
	if got := oauthDisplayName(idTokenClaims{GivenName: "Ada", Name: "Ada L."}, ""); got != "Ada" {
		t.Errorf("displayName = %q", got)
	}
	// Champ `user` posté par Apple au premier consentement.
	appleUser := `{"name":{"firstName":"Jotaro","lastName":"K"},"email":"x@y.z"}`
	if got := oauthDisplayName(idTokenClaims{}, appleUser); got != "Jotaro" {
		t.Errorf("displayName apple = %q", got)
	}
	// JSON invalide → vide, sans erreur.
	if got := oauthDisplayName(idTokenClaims{}, "{"); got != "" {
		t.Errorf("displayName json invalide = %q", got)
	}
}
