package users

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const SessionCookieName = "jolyne_user"
const SessionTTL = 30 * 24 * time.Hour // 30 jours — usage récurrent attendu.

// Session : payload signé contenu dans le cookie. Pas de PII (l'email
// reste server-side, le client n'a besoin que de l'ID pour les calls API).
// Version = compteur de révocation miroir de users.session_version : bumpé au
// reset de mot de passe, il invalide les cookies plus anciens.
type Session struct {
	UserID    int64
	Version   int64
	ExpiresAt time.Time
}

// Sign crée un token `<b64(payload)>.<b64(hmac)>` où payload =
// "uid|version|unixts". L'ancien format à 2 champs (uid|unixts) reste accepté
// en lecture (version = 0) pour ne pas déconnecter tout le monde au déploiement.
func Sign(s Session, secret []byte) string {
	payload := strconv.FormatInt(s.UserID, 10) + "|" +
		strconv.FormatInt(s.Version, 10) + "|" +
		strconv.FormatInt(s.ExpiresAt.Unix(), 10)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(payload))
	sig := mac.Sum(nil)
	return b64(payload) + "." + b64(sig)
}

// VerifySession renvoie la Session si la signature est valide et le token
// non expiré.
func VerifySession(token string, secret []byte) (Session, error) {
	if token == "" {
		return Session{}, fmt.Errorf("users: cookie vide")
	}
	dot := strings.Index(token, ".")
	if dot <= 0 || dot == len(token)-1 {
		return Session{}, fmt.Errorf("users: cookie malformé")
	}
	payloadB64, sigB64 := token[:dot], token[dot+1:]

	payload, err := base64.URLEncoding.DecodeString(payloadB64)
	if err != nil {
		return Session{}, fmt.Errorf("users: payload b64: %w", err)
	}
	sig, err := base64.URLEncoding.DecodeString(sigB64)
	if err != nil {
		return Session{}, fmt.Errorf("users: signature b64: %w", err)
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return Session{}, fmt.Errorf("users: signature invalide")
	}

	// Format courant : "uid|version|ts". Ancien format toléré : "uid|ts"
	// (version implicite 0) — évite de déconnecter les sessions signées avant
	// l'introduction du versionnage.
	parts := strings.Split(string(payload), "|")
	var uid, version, ts int64
	switch len(parts) {
	case 2:
		uid, err = strconv.ParseInt(parts[0], 10, 64)
		if err != nil {
			return Session{}, fmt.Errorf("users: uid: %w", err)
		}
		ts, err = strconv.ParseInt(parts[1], 10, 64)
		if err != nil {
			return Session{}, fmt.Errorf("users: timestamp: %w", err)
		}
	case 3:
		uid, err = strconv.ParseInt(parts[0], 10, 64)
		if err != nil {
			return Session{}, fmt.Errorf("users: uid: %w", err)
		}
		version, err = strconv.ParseInt(parts[1], 10, 64)
		if err != nil {
			return Session{}, fmt.Errorf("users: version: %w", err)
		}
		ts, err = strconv.ParseInt(parts[2], 10, 64)
		if err != nil {
			return Session{}, fmt.Errorf("users: timestamp: %w", err)
		}
	default:
		return Session{}, fmt.Errorf("users: payload malformé")
	}
	exp := time.Unix(ts, 0)
	if time.Now().After(exp) {
		return Session{}, fmt.Errorf("users: session expirée")
	}
	return Session{UserID: uid, Version: version, ExpiresAt: exp}, nil
}

func b64[T string | []byte](v T) string {
	switch x := any(v).(type) {
	case string:
		return base64.URLEncoding.EncodeToString([]byte(x))
	case []byte:
		return base64.URLEncoding.EncodeToString(x)
	}
	return ""
}
