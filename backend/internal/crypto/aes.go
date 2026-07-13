// Package crypto regroupe les primitives cryptographiques applicatives.
// Pour l'instant : AES-256-GCM authentifié pour le chiffrement des messages
// capturés lors d'un signalement (exigence RGPD/DSA : chiffrés au repos,
// lisibles uniquement par le back-office).
//
// Génération d'une clé en local :
//
//	openssl rand -base64 32
//
// À stocker dans la variable d'env REPORT_ENCRYPTION_KEY, jamais en code.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
)

// Box est un coffre AES-256-GCM. La nonce est générée aléatoirement à
// chaque Seal et préfixe le ciphertext renvoyé.
type Box struct {
	aead cipher.AEAD
}

// NewBox parse une clé base64 (32 octets ⇒ AES-256) et prépare le coffre.
func NewBox(keyB64 string) (*Box, error) {
	if keyB64 == "" {
		return nil, fmt.Errorf("crypto: REPORT_ENCRYPTION_KEY vide")
	}
	key, err := base64.StdEncoding.DecodeString(keyB64)
	if err != nil {
		return nil, fmt.Errorf("crypto: décodage base64: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("crypto: clé doit faire 32 octets (256 bits), got %d", len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("crypto: aes: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("crypto: gcm: %w", err)
	}
	return &Box{aead: aead}, nil
}

// Seal chiffre `plaintext` et préfixe la sortie d'une nonce aléatoire.
func (b *Box) Seal(plaintext []byte) ([]byte, error) {
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("crypto: nonce: %w", err)
	}
	return b.aead.Seal(nonce, nonce, plaintext, nil), nil
}

// Open déchiffre une sortie produite par Seal. Vérifie l'authenticité.
func (b *Box) Open(ciphertext []byte) ([]byte, error) {
	ns := b.aead.NonceSize()
	if len(ciphertext) < ns {
		return nil, fmt.Errorf("crypto: ciphertext trop court")
	}
	return b.aead.Open(nil, ciphertext[:ns], ciphertext[ns:], nil)
}
