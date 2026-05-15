// Outil CLI pour générer un hash bcrypt à coller dans ADMIN_USERS.
//
// Usage :
//
//	cd backend && go run ./cmd/admin-hash 'mon mot de passe'
//
// Sort : le hash bcrypt prêt à coller. Pas de log du mot de passe.
package main

import (
	"fmt"
	"os"

	"golang.org/x/crypto/bcrypt"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: admin-hash <password>")
		os.Exit(1)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(os.Args[1]), 10)
	if err != nil {
		fmt.Fprintln(os.Stderr, "bcrypt:", err)
		os.Exit(1)
	}
	fmt.Println(string(hash))
}
