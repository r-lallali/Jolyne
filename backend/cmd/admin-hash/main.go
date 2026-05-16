// Outil CLI pour générer / vérifier un hash bcrypt admin.
//
// Génération :
//
//	cd backend && go run ./cmd/admin-hash 'mon mot de passe'
//
// Vérification (utile pour valider que le hash que tu as collé dans
// ADMIN_USERS correspond bien à ton mot de passe — exclut une corruption
// du `$` dans le pipeline Dokploy / docker-compose) :
//
//	cd backend && go run ./cmd/admin-hash --verify 'password' '$2a$10$...'
//
// Le mot de passe ne touche JAMAIS les logs.
package main

import (
	"fmt"
	"os"

	"golang.org/x/crypto/bcrypt"
)

func main() {
	args := os.Args[1:]
	switch {
	case len(args) == 1:
		generate(args[0])
	case len(args) == 3 && args[0] == "--verify":
		verify(args[1], args[2])
	default:
		fmt.Fprintln(os.Stderr, "usage:")
		fmt.Fprintln(os.Stderr, "  admin-hash <password>")
		fmt.Fprintln(os.Stderr, "  admin-hash --verify <password> <bcrypt-hash>")
		os.Exit(2)
	}
}

func generate(password string) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	if err != nil {
		fmt.Fprintln(os.Stderr, "bcrypt:", err)
		os.Exit(1)
	}
	fmt.Println(string(hash))
}

func verify(password, hash string) {
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		fmt.Fprintln(os.Stderr, "MISMATCH:", err)
		fmt.Fprintln(os.Stderr, "→ Le hash ne correspond pas au password.")
		fmt.Fprintf(os.Stderr, "  hash longueur : %d (un bcrypt valide fait 60 caractères)\n", len(hash))
		fmt.Fprintf(os.Stderr, "  hash préfixe  : %q (devrait être $2a$, $2b$ ou $2y$)\n", first(hash, 4))
		os.Exit(1)
	}
	fmt.Println("OK — hash et password correspondent.")
}

func first(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
