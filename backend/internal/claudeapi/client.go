// Package claudeapi : wrapper HTTP minimal autour de l'Anthropic Messages
// API. Pas de SDK officiel pour limiter les deps. Le seul usage prévu
// dans Jolyne est le bot prof IA (cf. botpeer/) — on garde l'interface
// volontairement étroite : un appel = une réponse texte.
//
// CLAUDE.md règle d'or #1 : aucun contenu de message n'est loggé ici.
// Les erreurs réseau / 5xx sont remontées sans détailler le payload.
package claudeapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	defaultEndpoint = "https://api.anthropic.com/v1/messages"
	defaultAPIVer   = "2023-06-01"
	// ID canonique avec date — aligné sur le default de config.go et le
	// docker-compose. Un alias/modèle inconnu fait échouer tout appel en 404
	// (prof IA muet) ; on garde donc l'ID daté comme repli sûr.
	defaultModel     = "claude-haiku-4-5-20251001"
	defaultMaxTokens = 256
	// defaultTimeout est PAR TENTATIVE et borne la génération entière : l'appel
	// est non-streaming, l'API n'envoie ses headers qu'une fois les ~256 tokens
	// générés. À 8s les générations de pointe se faisaient couper ("Client.Timeout
	// exceeded while awaiting headers" en prod) ; 12s + 1 retry transport couvre
	// la queue de latence en gardant l'attente max sous ~25s (l'UI affiche
	// "écrit…" pendant ce temps).
	defaultTimeout = 12 * time.Second

	// Retry sur 429 / 5xx / erreur transport (rate limit, overload, timeout).
	// Budgets distincts : un 5xx est rarement résolu en re-tentant vite (1 retry
	// suffit), alors qu'un 429 est par nature transitoire — quand plusieurs
	// profs IA parlent en même temps, c'est l'erreur dominante, d'où un budget
	// plus large. Les timeouts/erreurs réseau sont retentés UNE fois : un
	// dépassement de defaultTimeout est presque toujours une pointe de latence
	// transitoire côté API, et sans retry un seul timeout tuait la conversation
	// (réponse de repli + congé) — vu en prod.
	maxRetries5xx       = 1
	maxRetries429       = 2
	maxRetriesTransport = 1
	retryBackoff  = 600 * time.Millisecond
	// retryJitter étale les re-tentatives des appels concurrents : sans lui,
	// N bots pris dans le même pic 429 re-tentent au même instant et
	// re-collisionnent — le retry ne sert alors à rien.
	retryJitter   = 400 * time.Millisecond
	maxRetryAfter = 4 * time.Second
)

// ErrDisabled : le client est instancié mais pas de clé API → tout
// appel échoue immédiatement, à charge du caller de fallback.
var ErrDisabled = errors.New("claudeapi: disabled (no API key)")

type Client struct {
	apiKey    string
	model     string
	endpoint  string
	apiVer    string
	maxTokens int
	http      *http.Client
	log       *slog.Logger
}

type Option func(*Client)

func WithModel(m string) Option        { return func(c *Client) { c.model = m } }
func WithLogger(l *slog.Logger) Option { return func(c *Client) { c.log = l } }
func WithHTTPClient(h *http.Client) Option {
	return func(c *Client) { c.http = h }
}

// WithMaxTokens relève le plafond de génération (défaut 256 — taillé pour
// les réponses courtes du prof IA). Le traducteur de phrases en a besoin :
// traduction + romanisation d'un texte de 500 runes dépassent 256 tokens.
func WithMaxTokens(n int) Option {
	return func(c *Client) {
		if n > 0 {
			c.maxTokens = n
		}
	}
}

// New : retourne un Client. Si apiKey est vide, le client est "disabled"
// et chaque Reply renverra ErrDisabled. Permet de garder le câblage du
// caller indépendant de la configuration.
func New(apiKey string, opts ...Option) *Client {
	// Pool dimensionné pour des appels simultanés : le Transport par défaut ne
	// garde que 2 connexions idle par hôte — au-delà de 2 profs IA répondant
	// en même temps, chaque appel paierait un handshake TCP+TLS complet vers
	// api.anthropic.com (latence ↑, donc plus de timeouts à defaultTimeout et
	// de réponses de repli). 64 couvre BOT_MAX_CONCURRENT avec de la marge.
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.MaxIdleConns = 64
	tr.MaxIdleConnsPerHost = 64
	c := &Client{
		apiKey:    apiKey,
		model:     defaultModel,
		endpoint:  defaultEndpoint,
		apiVer:    defaultAPIVer,
		maxTokens: defaultMaxTokens,
		http:      &http.Client{Timeout: defaultTimeout, Transport: tr},
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// Enabled : true si une clé API est posée. Le caller peut s'en servir
// pour décider de ne pas armer son timer 10s par exemple.
func (c *Client) Enabled() bool { return c != nil && c.apiKey != "" }

// Message : tour d'historique passé à Reply. Le rôle vaut "user" ou
// "assistant" — strict, l'API d'Anthropic rejette les autres valeurs.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type messagesRequest struct {
	Model     string    `json:"model"`
	MaxTokens int       `json:"max_tokens"`
	System    string    `json:"system,omitempty"`
	Messages  []Message `json:"messages"`
}

type contentBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type messagesResponse struct {
	Content    []contentBlock `json:"content"`
	StopReason string         `json:"stop_reason"`
}

type apiError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

type apiErrorEnvelope struct {
	Type  string   `json:"type"`
	Error apiError `json:"error"`
}

// Reply : envoie l'historique + le dernier message user et retourne le
// texte de la réponse de Claude. `system` est le system prompt
// (rôle + règles). L'historique doit alterner user/assistant, et on y
// pousse le dernier user message implicitement — le caller fournit
// donc `history` sans le tour user courant et passe `userMsg` à part.
func (c *Client) Reply(ctx context.Context, system string, history []Message, userMsg string) (string, error) {
	if !c.Enabled() {
		return "", ErrDisabled
	}
	msgs := make([]Message, 0, len(history)+1)
	msgs = append(msgs, history...)
	msgs = append(msgs, Message{Role: "user", Content: userMsg})

	// L'API Anthropic exige que le 1er message soit de rôle "user". Un
	// historique ouvrant sur un tour "assistant" (typiquement le greeting du
	// bot, qui parle en premier) provoque un 400 — donc, sans ce garde-fou,
	// le bot répondrait en erreur à TOUS les messages suivants. On rogne les
	// tours de tête jusqu'au premier "user".
	for len(msgs) > 0 && msgs[0].Role != "user" {
		msgs = msgs[1:]
	}

	reqBody, err := json.Marshal(messagesRequest{
		Model:     c.model,
		MaxTokens: c.maxTokens,
		System:    system,
		Messages:  msgs,
	})
	if err != nil {
		return "", fmt.Errorf("claudeapi: marshal request: %w", err)
	}

	backoff := retryBackoff
	for attempt := 0; ; attempt++ {
		if attempt > 0 {
			// Backoff entre deux tentatives (429/5xx) — respecte l'annulation.
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(backoff):
			}
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(reqBody))
		if err != nil {
			return "", fmt.Errorf("claudeapi: new request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-api-key", c.apiKey)
		req.Header.Set("anthropic-version", c.apiVer)

		resp, err := c.http.Do(req)
		if err != nil {
			// Timeout / erreur transport : transitoire dans l'immense majorité
			// des cas (pointe de latence API, connexion idle recyclée). Voir
			// note sur maxRetriesTransport en tête de fichier.
			if attempt < maxRetriesTransport {
				backoff = retryBackoff + time.Duration(rand.Int63n(int64(retryJitter)))
				if c.log != nil {
					c.log.Warn("claudeapi retrying", "err", err, "attempt", attempt+1)
				}
				continue
			}
			return "", fmt.Errorf("claudeapi: http do: %w", err)
		}
		body, rerr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		status := resp.StatusCode
		retryAfter := parseRetryAfter(resp.Header.Get("Retry-After"))
		_ = resp.Body.Close()
		if rerr != nil {
			return "", fmt.Errorf("claudeapi: read body: %w", rerr)
		}

		// 429 / 5xx : transitoire (rate limit, overload). On re-tente s'il
		// reste des tentatives, sinon on remonte l'erreur au caller (qui
		// bascule sur sa réponse de repli).
		if status == http.StatusTooManyRequests || status >= 500 {
			var env apiErrorEnvelope
			_ = json.Unmarshal(body, &env)
			lastErr := fmt.Errorf("claudeapi: status %d: %s", status, env.Error.Type)
			limit := maxRetries5xx
			if status == http.StatusTooManyRequests {
				limit = maxRetries429
			}
			if attempt < limit {
				backoff = retryBackoff
				if retryAfter > 0 {
					backoff = retryAfter
				}
				// Jitter anti-troupeau : étale les retries des bots
				// concurrents pris dans le même pic de rate limit.
				backoff += time.Duration(rand.Int63n(int64(retryJitter)))
				if c.log != nil {
					c.log.Warn("claudeapi retrying", "status", status, "type", env.Error.Type, "attempt", attempt+1)
				}
				continue
			}
			if c.log != nil {
				c.log.Warn("claudeapi error response", "status", status, "type", env.Error.Type)
			}
			return "", lastErr
		}

		if status >= 400 {
			// 4xx non-retryable (400/401/403/404…) : erreur définitive.
			var env apiErrorEnvelope
			_ = json.Unmarshal(body, &env)
			if c.log != nil {
				// On log uniquement le type d'erreur, jamais le content envoyé.
				c.log.Warn("claudeapi error response", "status", status, "type", env.Error.Type)
			}
			return "", fmt.Errorf("claudeapi: status %d: %s", status, env.Error.Type)
		}

		var parsed messagesResponse
		if err := json.Unmarshal(body, &parsed); err != nil {
			return "", fmt.Errorf("claudeapi: parse response: %w", err)
		}
		for _, b := range parsed.Content {
			if b.Type == "text" && b.Text != "" {
				return b.Text, nil
			}
		}
		return "", fmt.Errorf("claudeapi: empty response")
	}
}

// parseRetryAfter lit l'en-tête Retry-After (secondes entières — format usuel
// d'Anthropic). Plafonné à maxRetryAfter pour ne pas geler le prof IA. Renvoie
// 0 si absent/illisible (le caller retombe alors sur retryBackoff).
func parseRetryAfter(v string) time.Duration {
	v = strings.TrimSpace(v)
	if v == "" {
		return 0
	}
	secs, err := strconv.Atoi(v)
	if err != nil || secs <= 0 {
		return 0
	}
	d := time.Duration(secs) * time.Second
	if d > maxRetryAfter {
		return maxRetryAfter
	}
	return d
}
