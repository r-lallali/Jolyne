// Package grammar wrap l'API LanguageTool self-hostée.
// Voir PLAN.md §4 Phase 2 (Correction grammaticale).
package grammar

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client appelle l'instance LanguageTool locale (réseau Docker).
type Client struct {
	baseURL string
	http    *http.Client
}

func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		http: &http.Client{
			Timeout: 8 * time.Second,
		},
	}
}

// Match : une faute détectée par LanguageTool. On expose le minimum dont
// le frontend a besoin pour souligner et proposer des remplacements.
type Match struct {
	Message      string   `json:"message"`
	ShortMessage string   `json:"short_message,omitempty"`
	Offset       int      `json:"offset"`
	Length       int      `json:"length"`
	Replacements []string `json:"replacements"`
}

type ltResponse struct {
	Matches []ltMatch `json:"matches"`
}

type ltMatch struct {
	Message      string `json:"message"`
	ShortMessage string `json:"shortMessage"`
	Offset       int    `json:"offset"`
	Length       int    `json:"length"`
	Replacements []struct {
		Value string `json:"value"`
	} `json:"replacements"`
}

// Check renvoie la liste des fautes détectées dans `text` pour la langue
// `lang` (codes ISO type "fr-FR", "en-US"). Tronque les replacements pour
// rester léger.
func (c *Client) Check(ctx context.Context, text, lang string) ([]Match, error) {
	form := url.Values{}
	form.Set("text", text)
	form.Set("language", lang)
	// `level=picky` capte plus de fautes stylistiques. À voir au tuning.
	form.Set("level", "default")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v2/check", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("grammar: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("grammar: do: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	if err != nil {
		return nil, fmt.Errorf("grammar: read: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("grammar: status %d: %s", resp.StatusCode, string(raw))
	}

	var out ltResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("grammar: decode: %w", err)
	}

	matches := make([]Match, 0, len(out.Matches))
	for _, m := range out.Matches {
		repl := make([]string, 0, len(m.Replacements))
		for i, r := range m.Replacements {
			if i >= 5 {
				break
			}
			repl = append(repl, r.Value)
		}
		matches = append(matches, Match{
			Message:      m.Message,
			ShortMessage: m.ShortMessage,
			Offset:       m.Offset,
			Length:       m.Length,
			Replacements: repl,
		})
	}
	return matches, nil
}
