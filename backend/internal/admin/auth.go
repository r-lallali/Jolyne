package admin

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const SessionCookieName = "jolyne_admin"

// SessionTTL : durée de validité d'un cookie de session admin (8h, pour
// matcher une journée de modération sans devoir se reconnecter constamment).
const SessionTTL = 8 * time.Hour

// Session est le payload signé contenu dans le cookie.
type Session struct {
	Email     string
	ExpiresAt time.Time
}

// Sign crée un token au format `<base64(payload)>.<base64(hmac)>` où
// payload = "email|unixts". L'HMAC-SHA256 est calculé avec la clé secrète
// du serveur.
func Sign(s Session, secret []byte) string {
	payload := s.Email + "|" + strconv.FormatInt(s.ExpiresAt.Unix(), 10)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(payload))
	sig := mac.Sum(nil)
	return b64(payload) + "." + b64String(sig)
}

// VerifySession retourne la Session si la signature est valide et non
// expirée.
func VerifySession(token string, secret []byte) (Session, error) {
	if token == "" {
		return Session{}, fmt.Errorf("admin: cookie vide")
	}
	dot := strings.Index(token, ".")
	if dot <= 0 || dot == len(token)-1 {
		return Session{}, fmt.Errorf("admin: cookie malformé")
	}
	payloadB64, sigB64 := token[:dot], token[dot+1:]

	payload, err := base64.URLEncoding.DecodeString(payloadB64)
	if err != nil {
		return Session{}, fmt.Errorf("admin: payload b64: %w", err)
	}
	sig, err := base64.URLEncoding.DecodeString(sigB64)
	if err != nil {
		return Session{}, fmt.Errorf("admin: signature b64: %w", err)
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return Session{}, fmt.Errorf("admin: signature invalide")
	}

	pipe := strings.Index(string(payload), "|")
	if pipe <= 0 || pipe == len(payload)-1 {
		return Session{}, fmt.Errorf("admin: payload malformé")
	}
	email := string(payload[:pipe])
	ts, err := strconv.ParseInt(string(payload[pipe+1:]), 10, 64)
	if err != nil {
		return Session{}, fmt.Errorf("admin: timestamp: %w", err)
	}
	exp := time.Unix(ts, 0)
	if time.Now().After(exp) {
		return Session{}, fmt.Errorf("admin: session expirée")
	}
	return Session{Email: email, ExpiresAt: exp}, nil
}

func b64(s string) string       { return base64.URLEncoding.EncodeToString([]byte(s)) }
func b64String(b []byte) string { return base64.URLEncoding.EncodeToString(b) }
