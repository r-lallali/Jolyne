// Package translate wrap l'API LibreTranslate self-hostée.
// Voir PLAN.md §4 Phase 2 (Tooltip de traduction) + §8 décisions
// (LibreTranslate self-host, gratuit, qualité moindre).
package translate

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client appelle l'instance LibreTranslate locale (réseau Docker).
// Le frontend ne tape JAMAIS LibreTranslate en direct — pas de clé exposée,
// rate limiting et observabilité restent côté Go.
type Client struct {
	baseURL string
	apiKey  string // optionnel — instance interne n'en a pas besoin
	http    *http.Client
}

func NewClient(baseURL, apiKey string) *Client {
	return &Client{
		baseURL: baseURL,
		apiKey:  apiKey,
		http: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

type translateRequest struct {
	Q      string `json:"q"`
	Source string `json:"source"`
	Target string `json:"target"`
	Format string `json:"format"`
	APIKey string `json:"api_key,omitempty"`
}

type translateResponse struct {
	TranslatedText string `json:"translatedText"`
	Error          string `json:"error,omitempty"`
}

// Translate renvoie la traduction de `text` de `source` vers `target`.
// `source` peut être "auto" pour laisser LibreTranslate détecter.
func (c *Client) Translate(ctx context.Context, text, source, target string) (string, error) {
	body, err := json.Marshal(translateRequest{
		Q:      text,
		Source: source,
		Target: target,
		Format: "text",
		APIKey: c.apiKey,
	})
	if err != nil {
		return "", fmt.Errorf("translate: marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/translate", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("translate: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("translate: do: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return "", fmt.Errorf("translate: read: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("translate: status %d: %s", resp.StatusCode, string(raw))
	}

	var out translateResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("translate: decode: %w", err)
	}
	if out.Error != "" {
		return "", fmt.Errorf("translate: %s", out.Error)
	}
	return out.TranslatedText, nil
}
