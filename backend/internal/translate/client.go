// Package translate wrap l'API LibreTranslate self-hostée (gratuite, qualité
// moindre — les phrases passent en priorité par Claude, cf. handler.go).
package translate

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
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
	// Présent uniquement quand source == "auto".
	DetectedLanguage *struct {
		Language   string  `json:"language"`
		Confidence float64 `json:"confidence"`
	} `json:"detectedLanguage,omitempty"`
	Error string `json:"error,omitempty"`
}

// Result porte la traduction et, si la source était "auto", la langue
// détectée par LibreTranslate (vide sinon). Romanization n'est remplie que
// par le traducteur IA (ai.go) pour les sources zh/ja/ko/ar — LibreTranslate
// n'en produit pas.
type Result struct {
	Translated   string
	Detected     string
	Romanization string
}

// Translate renvoie la traduction de `text` de `source` vers `target`.
// `source` peut être "auto" pour laisser LibreTranslate détecter.
func (c *Client) Translate(ctx context.Context, text, source, target string) (Result, error) {
	body, err := json.Marshal(translateRequest{ //nolint:gosec // G117 : api_key attendue par le protocole LibreTranslate
		Q:      text,
		Source: source,
		Target: target,
		Format: "text",
		APIKey: c.apiKey,
	})
	if err != nil {
		return Result{}, fmt.Errorf("translate: marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/translate", bytes.NewReader(body))
	if err != nil {
		return Result{}, fmt.Errorf("translate: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return Result{}, fmt.Errorf("translate: do: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return Result{}, fmt.Errorf("translate: read: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return Result{}, fmt.Errorf("translate: status %d: %s", resp.StatusCode, string(raw))
	}

	var out translateResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return Result{}, fmt.Errorf("translate: decode: %w", err)
	}
	if out.Error != "" {
		return Result{}, fmt.Errorf("translate: %s", out.Error)
	}
	res := Result{Translated: out.TranslatedText}
	if out.DetectedLanguage != nil {
		res.Detected = strings.ToLower(out.DetectedLanguage.Language)
	}
	return res, nil
}
