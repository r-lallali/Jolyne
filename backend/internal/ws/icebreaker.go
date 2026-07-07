package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"log/slog"
	"math/rand"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"

	"github.com/ralys/jolyne/backend/internal/claudeapi"
)

// IcebreakerService : amorces de conversation générées par Claude et servies
// au moment du match (frame `icebreakers`, envoyée en asynchrone APRÈS le
// matched — jamais bloquante pour l'appariement). Un pool d'amorces par
// langue pratiquée est caché dans Redis (TTL icebreakerTTL) : le coût API est
// d'un appel par langue et par fenêtre de cache, quel que soit le trafic.
// Cache froid + API en panne → le client garde ses amorces statiques locales
// (lib/icebreakers.ts), la feature dégrade sans bruit.
type IcebreakerService struct {
	Claude *claudeapi.Client
	RDB    *redis.Client
	Log    *slog.Logger

	// group déduplique les générations concurrentes par langue au sein du
	// process (cache miss simultanés → un seul appel Claude).
	group singleflight.Group
}

const (
	// icebreakerTTL : durée de vie du pool par langue. 6 h = les amorces se
	// renouvellent ~4×/jour, assez pour que les habitués ne revoient pas
	// toujours les mêmes.
	icebreakerTTL = 6 * time.Hour
	// icebreakerPoolSize : amorces demandées à Claude par génération.
	icebreakerPoolSize = 10
	// icebreakerServed : amorces servies à chaque match (tirage aléatoire).
	icebreakerServed = 3
	// icebreakerMaxLen : borne dure par amorce (runes) — une amorce est une
	// phrase courte, pas un paragraphe.
	icebreakerMaxLen = 90
	// icebreakerFetchTimeout : budget total du fetch (cache + éventuelle
	// génération). Au-delà, on abandonne — le client a son fallback statique.
	icebreakerFetchTimeout = 12 * time.Second
)

func (s *IcebreakerService) Enabled() bool {
	return s != nil && s.Claude.Enabled() && s.RDB != nil
}

func icebreakerKey(lang string) string { return "icebreakers:" + lang }

// Serve tire icebreakerServed amorces dans la langue pratiquée et les pousse
// au client. Conçu pour tourner en goroutine détachée depuis runChat : borne
// son propre timeout, n'émet rien en cas d'échec (fallback statique côté
// client). `stop` (Done du Conn) évite d'écrire sur une connexion partie.
func (s *IcebreakerService) Serve(conn *Conn, wants string) {
	if !s.Enabled() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), icebreakerFetchTimeout)
	defer cancel()

	pool, err := s.pool(ctx, wants)
	if err != nil || len(pool) == 0 {
		if err != nil && s.Log != nil {
			s.Log.Warn("icebreakers unavailable", "lang", wants, "err", err)
		}
		return
	}
	picks := pickRandom(pool, icebreakerServed)
	// Escape HTML (règle d'or #2) : le texte vient d'une IA, le client le
	// rend comme un message — même traitement que les messages du bot.
	for i, p := range picks {
		picks[i] = html.EscapeString(p)
	}
	select {
	case <-conn.Done():
		return
	default:
	}
	conn.Send(ServerFrame{Type: ServerIcebreakers, Suggestions: picks})
}

// pool renvoie le pool d'amorces de la langue, depuis Redis ou en le générant
// (singleflight par langue). Les erreurs Redis en lecture sont traitées comme
// un cache miss — Claude reste la source de secours.
func (s *IcebreakerService) pool(ctx context.Context, lang string) ([]string, error) {
	if raw, err := s.RDB.Get(ctx, icebreakerKey(lang)).Result(); err == nil {
		var pool []string
		if json.Unmarshal([]byte(raw), &pool) == nil && len(pool) > 0 {
			return pool, nil
		}
	}

	v, err, _ := s.group.Do(lang, func() (any, error) {
		// Re-check du cache sous le singleflight : un vol précédent a pu le
		// remplir pendant qu'on attendait.
		if raw, err := s.RDB.Get(ctx, icebreakerKey(lang)).Result(); err == nil {
			var pool []string
			if json.Unmarshal([]byte(raw), &pool) == nil && len(pool) > 0 {
				return pool, nil
			}
		}
		pool, err := s.generate(ctx, lang)
		if err != nil {
			return nil, err
		}
		if buf, err := json.Marshal(pool); err == nil {
			if err := s.RDB.Set(ctx, icebreakerKey(lang), buf, icebreakerTTL).Err(); err != nil && s.Log != nil {
				s.Log.Warn("icebreakers cache set", "err", err)
			}
		}
		return pool, nil
	})
	if err != nil {
		return nil, err
	}
	return v.([]string), nil
}

// generate demande un pool d'amorces fraîches à Claude. Contenu volontairement
// léger et universel (aucune donnée user dans le prompt).
func (s *IcebreakerService) generate(ctx context.Context, lang string) ([]string, error) {
	system := fmt.Sprintf(`Tu écris des amorces de conversation pour une app d'échange linguistique.
Génère %d messages d'ouverture courts en langue "%s" (code ISO 639-1), qu'un
apprenant pourrait envoyer tel quel à un inconnu natif pour démarrer un chat.

Contraintes :
- une seule phrase par amorce, maximum %d caractères, ton décontracté
- variées : voyage, cuisine, films/séries, musique, la journée de l'autre,
  une opinion légère, une question insolite — pas deux amorces sur le même thème
- adaptées à un niveau intermédiaire (vocabulaire simple, pas d'argot pointu)
- pas de salutation seule ("salut", "hello") : chaque amorce pose une vraie question
- aucune emoji, aucun markdown

Réponds UNIQUEMENT par un tableau JSON de chaînes, sans texte autour :
["...","..."]`, icebreakerPoolSize, lang, icebreakerMaxLen)

	raw, err := s.Claude.Reply(ctx, system, nil, "Génère les amorces.")
	if err != nil {
		return nil, fmt.Errorf("icebreakers generate: %w", err)
	}
	pool := parseIcebreakers(raw)
	if len(pool) == 0 {
		return nil, fmt.Errorf("icebreakers generate: réponse inexploitable")
	}
	return pool, nil
}

// parseIcebreakers isole le tableau JSON et filtre les amorces (non vides,
// bornées, dédupliquées). Renvoie nil si rien d'exploitable.
func parseIcebreakers(raw string) []string {
	start := strings.IndexByte(raw, '[')
	end := strings.LastIndexByte(raw, ']')
	if start < 0 || end <= start {
		return nil
	}
	var items []string
	if err := json.Unmarshal([]byte(raw[start:end+1]), &items); err != nil {
		return nil
	}
	seen := make(map[string]struct{}, len(items))
	out := make([]string, 0, len(items))
	for _, it := range items {
		it = strings.TrimSpace(it)
		if it == "" {
			continue
		}
		if r := []rune(it); len(r) > icebreakerMaxLen {
			continue
		}
		if _, dup := seen[it]; dup {
			continue
		}
		seen[it] = struct{}{}
		out = append(out, it)
		if len(out) == icebreakerPoolSize {
			break
		}
	}
	return out
}

// pickRandom tire n éléments distincts (ordre aléatoire) sans modifier src.
func pickRandom(src []string, n int) []string {
	if n > len(src) {
		n = len(src)
	}
	idx := rand.Perm(len(src))[:n]
	out := make([]string, n)
	for i, j := range idx {
		out[i] = src[j]
	}
	return out
}
