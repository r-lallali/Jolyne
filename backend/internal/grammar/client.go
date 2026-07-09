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
	// Transport dédié : une seule cible upstream, on garde un pool de
	// connexions ouvertes (le défaut MaxIdleConnsPerHost=2 force des
	// handshakes TCP à répétition dès qu'il y a un peu de concurrence).
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.MaxIdleConns = 32
	tr.MaxIdleConnsPerHost = 32
	return &Client{
		baseURL: baseURL,
		http: &http.Client{
			Timeout:   8 * time.Second,
			Transport: tr,
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

// Règles LanguageTool désactivées pour un contexte "chat informel" : les
// fautes que LT signale par défaut mais qui n'ont pas de sens dans une
// conversation décontractée (style SMS, sans ponctuation finale).
//
// Codes officiels (multilingues, mêmes IDs pour fr/en/es/de) :
//   - UPPERCASE_SENTENCE_START : majuscule manquante en début de phrase
//   - PUNCTUATION_PARAGRAPH_END : pas de point final
var disabledRules = strings.Join([]string{
	"UPPERCASE_SENTENCE_START",
	"PUNCTUATION_PARAGRAPH_END",
}, ",")

// Check renvoie la liste des fautes détectées dans `text` pour la langue
// `lang` (codes ISO type "fr-FR", "en-US"). Tronque les replacements pour
// rester léger. Une erreur transitoire (réseau ou 5xx) est retentée UNE
// fois après une courte pause : un redémarrage de LanguageTool ne doit pas
// se traduire par « vérification indisponible » côté user.
func (c *Client) Check(ctx context.Context, text, lang string) ([]Match, error) {
	matches, retryable, err := c.check(ctx, text, lang)
	if err == nil || !retryable {
		return matches, err
	}
	select {
	case <-ctx.Done():
		return nil, err
	case <-time.After(150 * time.Millisecond):
	}
	matches, _, err = c.check(ctx, text, lang)
	return matches, err
}

// check fait un appel LanguageTool unique. `retryable` distingue les pannes
// transitoires (réseau, 5xx) des erreurs définitives (4xx : re-tenter la
// même requête redonnera la même réponse).
func (c *Client) check(ctx context.Context, text, lang string) (_ []Match, retryable bool, _ error) {
	form := url.Values{}
	form.Set("text", text)
	form.Set("language", lang)
	// `level=picky` capte plus de fautes stylistiques. À voir au tuning.
	form.Set("level", "default")
	form.Set("disabledRules", disabledRules)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v2/check", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, false, fmt.Errorf("grammar: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.http.Do(req)
	if err != nil {
		// Contexte annulé/expiré : le retry échouerait pareil.
		return nil, ctx.Err() == nil, fmt.Errorf("grammar: do: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	if err != nil {
		return nil, true, fmt.Errorf("grammar: read: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, resp.StatusCode >= 500, fmt.Errorf("grammar: status %d: %s", resp.StatusCode, string(raw))
	}

	var out ltResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, false, fmt.Errorf("grammar: decode: %w", err)
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
	return matches, false, nil
}
