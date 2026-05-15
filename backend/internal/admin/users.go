// Package admin gère l'authentification et les endpoints du back-office.
// Auth séparée de l'auth user (jamais d'OAuth), credentials gérés via env
// vars hashées en bcrypt. Voir CLAUDE.md §"Back-office /admin".
package admin

import (
	"fmt"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

// User est un admin autorisé. Le hash bcrypt n'est jamais loggé.
type User struct {
	Email    string
	HashedPW string
}

// Users parse une chaîne au format
//
//	email1:$2a$10$...;email2:$2a$10$...
//
// Les hashes bcrypt ne contiennent jamais de `;`, le séparateur est donc
// sûr. Les espaces autour des entrées sont tolérés.
func ParseUsers(raw string) ([]User, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var users []User
	for i, part := range strings.Split(raw, ";") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		// On split sur le PREMIER ":" — les hashes bcrypt en contiennent.
		idx := strings.Index(part, ":")
		if idx < 0 {
			return nil, fmt.Errorf("admin users: entrée #%d sans ':' (format email:hash)", i+1)
		}
		email := strings.TrimSpace(part[:idx])
		hash := strings.TrimSpace(part[idx+1:])
		if email == "" || hash == "" {
			return nil, fmt.Errorf("admin users: entrée #%d email ou hash vide", i+1)
		}
		users = append(users, User{Email: strings.ToLower(email), HashedPW: hash})
	}
	return users, nil
}

// Erreurs sentinelles pour distinguer la cause d'un échec (logs côté
// serveur uniquement — le client voit toujours la même 404).
var (
	ErrEmailNotFound    = fmt.Errorf("admin: email inconnu")
	ErrPasswordMismatch = fmt.Errorf("admin: password ne matche pas le hash")
)

// VerifyCredentials renvoie l'email canonique si les credentials sont
// valides. Comparaison en temps constant via bcrypt.
func VerifyCredentials(users []User, email, password string) (string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	for _, u := range users {
		if u.Email != email {
			continue
		}
		if err := bcrypt.CompareHashAndPassword([]byte(u.HashedPW), []byte(password)); err != nil {
			return "", ErrPasswordMismatch
		}
		return u.Email, nil
	}
	// Compare factice pour ne pas révéler l'existence de l'email via le
	// timing (CWE-208).
	_ = bcrypt.CompareHashAndPassword(
		[]byte("$2a$10$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNO"),
		[]byte(password),
	)
	return "", ErrEmailNotFound
}

// LoadedEmails : utilitaire pour logger les emails admin chargés au boot.
func LoadedEmails(users []User) []string {
	out := make([]string, len(users))
	for i, u := range users {
		out[i] = u.Email
	}
	return out
}
