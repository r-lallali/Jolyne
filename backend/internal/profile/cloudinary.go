package profile

import (
	"context"
	"crypto/sha1" //nolint:gosec // G505 : SHA-1 imposé par la signature upload Cloudinary
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
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
	sum := sha1.Sum([]byte(b.String())) //nolint:gosec // G401 : SHA-1 requis par la signature Cloudinary
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

// Destroy deletes an image from Cloudinary using a signed API request.
func (c CloudinaryConfig) Destroy(ctx context.Context, publicID string) error {
	if !c.IsConfigured() {
		return fmt.Errorf("cloudinary: not configured")
	}
	ts := time.Now().Unix()

	// Parameters must be sorted alphabetically for signature:
	// public_id=xxx&timestamp=123
	payloadStr := fmt.Sprintf("public_id=%s&timestamp=%d%s", publicID, ts, c.APISecret)
	sum := sha1.Sum([]byte(payloadStr)) //nolint:gosec // G401 : SHA-1 requis par la signature Cloudinary
	signature := hex.EncodeToString(sum[:])

	endpoint := fmt.Sprintf("https://api.cloudinary.com/v1_1/%s/image/destroy", c.CloudName)

	values := url.Values{}
	values.Set("public_id", publicID)
	values.Set("api_key", c.APIKey)
	values.Set("timestamp", fmt.Sprintf("%d", ts))
	values.Set("signature", signature)

	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, strings.NewReader(values.Encode()))
	if err != nil {
		return fmt.Errorf("cloudinary: new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("cloudinary: post: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("cloudinary: delete status %d", resp.StatusCode)
	}

	return nil
}
