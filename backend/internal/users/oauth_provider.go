package users

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// oauthProvider : description d'un provider OIDC (Google, Apple) pour le
// flow authorization code côté serveur. Le client secret est une fonction :
// statique chez Google, JWT ES256 régénéré à chaque échange chez Apple.
type oauthProvider struct {
	name        string
	authURL     string
	tokenURL    string
	clientID    string
	scopes      string
	issuers     []string // valeurs `iss` acceptées dans l'id_token
	redirectURI string
	extraAuth   url.Values
	secret      func() (string, error)
}

func newGoogleProvider(clientID, clientSecret, redirectURI string) *oauthProvider {
	return &oauthProvider{ //nolint:gosec // G101 : URLs d'endpoints OAuth publics, pas de credential en dur
		name:        "google",
		authURL:     "https://accounts.google.com/o/oauth2/v2/auth",
		tokenURL:    "https://oauth2.googleapis.com/token",
		clientID:    clientID,
		scopes:      "openid email profile",
		issuers:     []string{"https://accounts.google.com", "accounts.google.com"},
		redirectURI: redirectURI,
		// select_account : sans lui, Google ré-authentifie silencieusement le
		// dernier compte — bloquant pour qui veut changer de compte Google.
		extraAuth: url.Values{"prompt": {"select_account"}},
		secret:    func() (string, error) { return clientSecret, nil },
	}
}

func newAppleProvider(clientID, teamID, keyID, privateKeyPEM, redirectURI string) (*oauthProvider, error) {
	key, err := parseAppleP8(privateKeyPEM)
	if err != nil {
		return nil, fmt.Errorf("oauth apple: clé privée: %w", err)
	}
	return &oauthProvider{ //nolint:gosec // G101 : URLs d'endpoints OAuth publics, pas de credential en dur
		name:     "apple",
		authURL:  "https://appleid.apple.com/auth/authorize",
		tokenURL: "https://appleid.apple.com/auth/token",
		clientID: clientID,
		scopes:   "name email",
		issuers:  []string{"https://appleid.apple.com"},
		// form_post imposé par Apple dès qu'un scope est demandé : le
		// callback arrive en POST (le state vit en Redis, pas en cookie —
		// un POST cross-site n'emporterait pas un cookie SameSite=Lax).
		extraAuth:   url.Values{"response_mode": {"form_post"}},
		redirectURI: redirectURI,
		secret: func() (string, error) {
			return appleClientSecret(teamID, keyID, clientID, key, time.Now())
		},
	}, nil
}

// authorizeURL : URL de redirection initiale vers l'écran de consentement.
func (p *oauthProvider) authorizeURL(state string) string {
	q := url.Values{
		"client_id":     {p.clientID},
		"redirect_uri":  {p.redirectURI},
		"response_type": {"code"},
		"scope":         {p.scopes},
		"state":         {state},
	}
	for k, vs := range p.extraAuth {
		q[k] = vs
	}
	return p.authURL + "?" + q.Encode()
}

// exchangeCode échange le code contre les tokens du provider et renvoie les
// claims de l'id_token, validés (iss / aud / exp).
//
// La signature de l'id_token n'est PAS vérifiée : le token arrive par un
// canal TLS direct avec le token endpoint du provider (OIDC Core §3.1.3.7
// autorise explicitement la validation TLS en lieu et place de la
// vérification de signature dans ce cas) — pas de JWKS à gérer.
func (p *oauthProvider) exchangeCode(ctx context.Context, hc *http.Client, code string) (idTokenClaims, error) {
	secret, err := p.secret()
	if err != nil {
		return idTokenClaims{}, fmt.Errorf("oauth %s: secret: %w", p.name, err)
	}
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {p.redirectURI},
		"client_id":     {p.clientID},
		"client_secret": {secret},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.tokenURL,
		strings.NewReader(form.Encode()))
	if err != nil {
		return idTokenClaims{}, fmt.Errorf("oauth %s: request: %w", p.name, err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := hc.Do(req)
	if err != nil {
		return idTokenClaims{}, fmt.Errorf("oauth %s: token endpoint: %w", p.name, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return idTokenClaims{}, fmt.Errorf("oauth %s: read: %w", p.name, err)
	}
	if resp.StatusCode != http.StatusOK {
		// Le corps peut contenir des détails sensibles — on ne log que le code.
		return idTokenClaims{}, fmt.Errorf("oauth %s: token endpoint status %d", p.name, resp.StatusCode)
	}
	var tok struct {
		IDToken string `json:"id_token"`
	}
	if err := json.Unmarshal(body, &tok); err != nil || tok.IDToken == "" {
		return idTokenClaims{}, fmt.Errorf("oauth %s: id_token absent", p.name)
	}
	claims, err := parseIDToken(tok.IDToken)
	if err != nil {
		return idTokenClaims{}, fmt.Errorf("oauth %s: %w", p.name, err)
	}
	if err := claims.validate(p.issuers, p.clientID, time.Now()); err != nil {
		return idTokenClaims{}, fmt.Errorf("oauth %s: %w", p.name, err)
	}
	return claims, nil
}

// idTokenClaims : sous-ensemble des claims OIDC dont on a besoin.
type idTokenClaims struct {
	Iss           string   `json:"iss"`
	Aud           flexAud  `json:"aud"`
	Exp           int64    `json:"exp"`
	Sub           string   `json:"sub"`
	Email         string   `json:"email"`
	EmailVerified flexBool `json:"email_verified"`
	GivenName     string   `json:"given_name"` // Google (scope profile)
	Name          string   `json:"name"`       // Google, repli
}

func (c idTokenClaims) validate(issuers []string, clientID string, now time.Time) error {
	okIss := false
	for _, iss := range issuers {
		if c.Iss == iss {
			okIss = true
			break
		}
	}
	if !okIss {
		return fmt.Errorf("id_token: iss inattendu")
	}
	okAud := false
	for _, aud := range c.Aud {
		if aud == clientID {
			okAud = true
			break
		}
	}
	if !okAud {
		return fmt.Errorf("id_token: aud inattendu")
	}
	if c.Exp <= now.Unix() {
		return fmt.Errorf("id_token: expiré")
	}
	if c.Sub == "" {
		return fmt.Errorf("id_token: sub vide")
	}
	return nil
}

// displayName : meilleur nom affichable dérivé des claims (prénom seul de
// préférence — le nom complet n'a rien à faire sur un profil public).
func (c idTokenClaims) displayName() string {
	if c.GivenName != "" {
		return c.GivenName
	}
	return c.Name
}

// parseIDToken décode le payload (2e segment) d'un JWT sans vérifier la
// signature — voir le commentaire d'exchangeCode pour la justification.
func parseIDToken(raw string) (idTokenClaims, error) {
	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return idTokenClaims{}, fmt.Errorf("id_token: format invalide")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return idTokenClaims{}, fmt.Errorf("id_token: base64: %w", err)
	}
	var claims idTokenClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return idTokenClaims{}, fmt.Errorf("id_token: json: %w", err)
	}
	return claims, nil
}

// flexAud : `aud` arrive en string (Google, Apple) mais la spec JWT autorise
// un tableau — on accepte les deux.
type flexAud []string

func (a *flexAud) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err == nil {
		*a = []string{s}
		return nil
	}
	var ss []string
	if err := json.Unmarshal(data, &ss); err != nil {
		return err
	}
	*a = ss
	return nil
}

// flexBool : `email_verified` arrive en bool (Google) ou en string
// "true"/"false" (Apple, historiquement). Toute autre valeur = false.
type flexBool bool

func (b *flexBool) UnmarshalJSON(data []byte) error {
	*b = flexBool(strings.Trim(string(data), `"`) == "true")
	return nil
}
