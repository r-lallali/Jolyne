package moderation

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// LocalScorer appelle le sidecar toxicity-scorer (réseau Docker) : un modèle
// supervisé multilingue (Detoxify / XLM-RoBERTa) qui score la toxicité d'un
// message sur CPU, gratuitement. Il sert de premier étage à la cascade de
// modération : la grande majorité des messages sont manifestement sains et
// n'ont pas besoin de Claude — seule la zone au-dessus du seuil remonte au
// classifieur IA, qui reste le juge nuancé.
//
// Règle d'or #1 : le texte transite vers le sidecar (local) mais n'est
// jamais loggé, ni ici ni côté Python.
type LocalScorer struct {
	baseURL string
	http    *http.Client
}

func NewLocalScorer(baseURL string) *LocalScorer {
	// Transport keep-alive : un score par message de chat, la connexion au
	// sidecar doit rester ouverte. Timeout court — au-delà, la cascade
	// dégrade sur Claude, on ne retient jamais la modération sur le sidecar.
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.MaxIdleConns = 32
	tr.MaxIdleConnsPerHost = 32
	return &LocalScorer{
		baseURL: baseURL,
		http: &http.Client{
			Timeout:   3 * time.Second,
			Transport: tr,
		},
	}
}

type scoreRequest struct {
	Text string `json:"text"`
}

type scoreResponse struct {
	// Score : max des têtes du modèle (toxicity, insult, threat…), 0..1.
	Score float64 `json:"score"`
}

// Score renvoie la toxicité estimée de `text` (0 = sain, 1 = toxique).
// Toute erreur est remontée au caller, qui dégrade sur Claude.
func (s *LocalScorer) Score(ctx context.Context, text string) (float64, error) {
	body, err := json.Marshal(scoreRequest{Text: text})
	if err != nil {
		return 0, fmt.Errorf("scorer: marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.baseURL+"/score", bytes.NewReader(body))
	if err != nil {
		return 0, fmt.Errorf("scorer: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.http.Do(req)
	if err != nil {
		return 0, fmt.Errorf("scorer: do: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 16*1024))
	if err != nil {
		return 0, fmt.Errorf("scorer: read: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("scorer: status %d", resp.StatusCode)
	}
	var out scoreResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return 0, fmt.Errorf("scorer: decode: %w", err)
	}
	if out.Score < 0 || out.Score > 1 {
		return 0, fmt.Errorf("scorer: score hors bornes: %f", out.Score)
	}
	return out.Score, nil
}
