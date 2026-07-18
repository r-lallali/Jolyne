package users

import (
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"time"
)

// Apple n'a pas de client secret statique : chaque appel au token endpoint
// présente un JWT signé ES256 avec la clé privée .p8 du developer account
// (kid = Key ID, iss = Team ID, sub = Services ID). On le génère en stdlib —
// pas la peine d'une lib JWT pour un seul token à signer.

// appleSecretTTL : durée de vie du secret généré. Apple accepte jusqu'à
// 6 mois ; on signe court puisqu'on régénère à chaque échange.
const appleSecretTTL = 5 * time.Minute

// parseAppleP8 : clé privée ECDSA P-256 depuis le PEM PKCS#8 (.p8) téléchargé
// de la console Apple. Le contenu est passé en env var — les \n littéraux
// éventuels (copier-coller une seule ligne dans l'UI Dokploy) sont restaurés.
func parseAppleP8(pemStr string) (*ecdsa.PrivateKey, error) {
	pemStr = restoreNewlines(pemStr)
	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		return nil, fmt.Errorf("PEM invalide")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("PKCS8: %w", err)
	}
	key, ok := parsed.(*ecdsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("clé non ECDSA")
	}
	return key, nil
}

// appleClientSecret construit le JWT ES256. La signature JWT est le format
// brut R||S (32+32 octets), pas l'ASN.1 de ecdsa.SignASN1.
func appleClientSecret(teamID, keyID, clientID string, key *ecdsa.PrivateKey, now time.Time) (string, error) {
	header, err := json.Marshal(map[string]string{"alg": "ES256", "kid": keyID})
	if err != nil {
		return "", err
	}
	claims, err := json.Marshal(map[string]any{
		"iss": teamID,
		"iat": now.Unix(),
		"exp": now.Add(appleSecretTTL).Unix(),
		"aud": "https://appleid.apple.com",
		"sub": clientID,
	})
	if err != nil {
		return "", err
	}
	b64 := base64.RawURLEncoding.EncodeToString
	signing := b64(header) + "." + b64(claims)
	digest := sha256.Sum256([]byte(signing))
	r, s, err := ecdsa.Sign(rand.Reader, key, digest[:])
	if err != nil {
		return "", fmt.Errorf("signature ES256: %w", err)
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	return signing + "." + b64(sig), nil
}

// restoreNewlines : une clé PEM collée sur une seule ligne dans une UI d'env
// vars arrive souvent avec des "\n" littéraux — on les convertit en vrais
// retours à la ligne pour que pem.Decode s'y retrouve.
func restoreNewlines(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' && i+1 < len(s) && s[i+1] == 'n' {
			out = append(out, '\n')
			i++
			continue
		}
		out = append(out, s[i])
	}
	return string(out)
}
