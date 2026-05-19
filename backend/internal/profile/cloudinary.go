package profile

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"
)

// CloudinaryConfig : api_key + api_secret + cloud_name récupérés sur le
// dashboard Cloudinary. Le secret reste UNIQUEMENT côté serveur — il sert
// à signer les upload params ; le front upload directement à Cloudinary
// avec la signature.
type CloudinaryConfig struct {
	CloudName string
	APIKey    string
	APISecret string
	Folder    string // ex: "jolyne/avatars" — préfixe public_id
}

// UploadParams : ce que le backend signe et renvoie au front. Le front
// les POST tels quels à https://api.cloudinary.com/v1_1/{cloud}/image/upload
// + le fichier en `file`.
type UploadParams struct {
	Timestamp int64  `json:"timestamp"`
	APIKey    string `json:"api_key"`
	Signature string `json:"signature"`
	Folder    string `json:"folder"`
	CloudName string `json:"cloud_name"`
}

// Sign : SHA-1 de "k1=v1&k2=v2..." (params ALPHABÉTIQUES, sans api_key
// ni signature) concaténé au api_secret. Voir docs Cloudinary "signed
// uploads". On signe folder + timestamp ici.
func (c CloudinaryConfig) Sign() UploadParams {
	ts := time.Now().Unix()
	params := map[string]string{
		"folder":    c.Folder,
		"timestamp": fmt.Sprintf("%d", ts),
	}
	keys := make([]string, 0, len(params))
	for k := range params {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for i, k := range keys {
		if i > 0 {
			b.WriteByte('&')
		}
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(params[k])
	}
	b.WriteString(c.APISecret)
	sum := sha1.Sum([]byte(b.String()))
	return UploadParams{
		Timestamp: ts,
		APIKey:    c.APIKey,
		Signature: hex.EncodeToString(sum[:]),
		Folder:    c.Folder,
		CloudName: c.CloudName,
	}
}

// IsConfigured : utilisable que si toutes les credentials sont posées.
func (c CloudinaryConfig) IsConfigured() bool {
	return c.CloudName != "" && c.APIKey != "" && c.APISecret != ""
}
