package claudeapi

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// Support de la Message Batches API (https://api.anthropic.com/v1/messages/batches) :
// mêmes requêtes que Reply mais traitées en asynchrone par Anthropic à −50 %
// du prix. Utilisé par l'analyse post-conversation, dont le résultat n'est
// pas attendu à chaud (carnet de vocab, leçon du jour, score CECRL).
//
// Règle d'or #1 inchangée : aucun contenu n'est loggé — seuls les statuts et
// types d'erreur le sont.

// BatchItem : une requête du lot. Un tour unique (system + message user),
// identifié par CustomID pour réapparier le résultat (les résultats arrivent
// dans un ordre quelconque).
type BatchItem struct {
	CustomID string
	System   string
	UserMsg  string
}

type batchRequestEntry struct {
	CustomID string          `json:"custom_id"`
	Params   messagesRequest `json:"params"`
}

type batchCreateRequest struct {
	Requests []batchRequestEntry `json:"requests"`
}

type batchStatusResponse struct {
	ID               string `json:"id"`
	ProcessingStatus string `json:"processing_status"`
}

// SubmitBatch soumet le lot et renvoie l'ID du batch à poller. Le caller
// garde ses items en mémoire jusqu'aux résultats.
func (c *Client) SubmitBatch(ctx context.Context, items []BatchItem) (string, error) {
	if !c.Enabled() {
		return "", ErrDisabled
	}
	if len(items) == 0 {
		return "", fmt.Errorf("claudeapi: batch vide")
	}
	entries := make([]batchRequestEntry, 0, len(items))
	for _, it := range items {
		entries = append(entries, batchRequestEntry{
			CustomID: it.CustomID,
			Params: messagesRequest{
				Model:     c.model,
				MaxTokens: c.maxTokens,
				System:    it.System,
				Messages:  []Message{{Role: "user", Content: it.UserMsg}},
			},
		})
	}
	body, err := json.Marshal(batchCreateRequest{Requests: entries})
	if err != nil {
		return "", fmt.Errorf("claudeapi: batch marshal: %w", err)
	}
	raw, err := c.doBatch(ctx, http.MethodPost, c.endpoint+"/batches", body)
	if err != nil {
		return "", err
	}
	var out batchStatusResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("claudeapi: batch parse: %w", err)
	}
	if out.ID == "" {
		return "", fmt.Errorf("claudeapi: batch sans id")
	}
	return out.ID, nil
}

// BatchEnded : true quand le lot est terminé (processing_status "ended") et
// que les résultats sont récupérables.
func (c *Client) BatchEnded(ctx context.Context, batchID string) (bool, error) {
	raw, err := c.doBatch(ctx, http.MethodGet, c.endpoint+"/batches/"+batchID, nil)
	if err != nil {
		return false, err
	}
	var out batchStatusResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return false, fmt.Errorf("claudeapi: batch parse: %w", err)
	}
	return out.ProcessingStatus == "ended", nil
}

// batchResultLine : une ligne du flux JSONL de résultats.
type batchResultLine struct {
	CustomID string `json:"custom_id"`
	Result   struct {
		Type    string           `json:"type"` // succeeded | errored | canceled | expired
		Message messagesResponse `json:"message"`
	} `json:"result"`
}

// BatchResults récupère les résultats d'un lot terminé : custom_id → texte de
// la réponse. Les requêtes en échec sont absentes de la map (le caller décide
// d'abandonner ou de re-tenter) ; l'usage des réussites est comptabilisé via
// l'observateur du client.
func (c *Client) BatchResults(ctx context.Context, batchID string) (map[string]string, error) {
	raw, err := c.doBatch(ctx, http.MethodGet, c.endpoint+"/batches/"+batchID+"/results", nil)
	if err != nil {
		return nil, err
	}
	results := make(map[string]string)
	sc := bufio.NewScanner(bytes.NewReader(raw))
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for sc.Scan() {
		line := bytes.TrimSpace(sc.Bytes())
		if len(line) == 0 {
			continue
		}
		var entry batchResultLine
		if err := json.Unmarshal(line, &entry); err != nil {
			if c.log != nil {
				c.log.Warn("claudeapi batch result line invalide", "err", err)
			}
			continue
		}
		if entry.Result.Type != "succeeded" {
			c.observeUsage("error", 0, 0)
			if c.log != nil {
				c.log.Warn("claudeapi batch result en échec", "type", entry.Result.Type)
			}
			continue
		}
		for _, b := range entry.Result.Message.Content {
			if b.Type == "text" && b.Text != "" {
				results[entry.CustomID] = b.Text
				c.observeUsage("ok",
					entry.Result.Message.Usage.InputTokens,
					entry.Result.Message.Usage.OutputTokens)
				break
			}
		}
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("claudeapi: batch results scan: %w", err)
	}
	return results, nil
}

// doBatch : un aller-retour HTTP vers l'API batches, sans retry — les
// callers sont des boucles de fond qui re-tenteront au tick suivant.
func (c *Client) doBatch(ctx context.Context, method, url string, body []byte) ([]byte, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return nil, fmt.Errorf("claudeapi: batch request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("anthropic-version", c.apiVer)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("claudeapi: batch do: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, fmt.Errorf("claudeapi: batch read: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		var env apiErrorEnvelope
		_ = json.Unmarshal(raw, &env)
		if c.log != nil {
			c.log.Warn("claudeapi batch error response", "status", resp.StatusCode, "type", env.Error.Type)
		}
		return nil, fmt.Errorf("claudeapi: batch status %d: %s", resp.StatusCode, env.Error.Type)
	}
	return raw, nil
}
