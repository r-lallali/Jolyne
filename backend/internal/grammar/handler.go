package grammar

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

const maxTextRunes = 2000

// TTL du cache de vérifications. Même logique que le cache de traductions :
// les textes courts reviennent souvent (mêmes phrases d'apprentissage), et
// LanguageTool est déterministe pour un texte+langue donnés. Le TTL borne la
// staleness si l'image LT est mise à jour (nouvelles règles).
const cacheTTL = 7 * 24 * time.Hour

// Codes BCP-47 acceptés. On accepte le code court (ex: "fr") en plus du
// long (ex: "fr-FR") pour coller au format `lang` qu'envoie le frontend
// quand l'utilisateur choisit sa langue. Le coréen, non géré par
// LanguageTool, passe par le correcteur IA (voir aiLangs) — sans IA
// configurée la requête retourne 400 et le frontend dégrade en
// « vérification indisponible ».
var langAliases = map[string]string{
	"fr":    "fr",
	"fr-fr": "fr-FR",
	"en":    "en-US",
	"en-us": "en-US",
	"en-gb": "en-GB",
	"es":    "es",
	"es-es": "es",
	"de":    "de-DE",
	"de-de": "de-DE",
	"pt":    "pt-PT",
	"pt-pt": "pt-PT",
	"pt-br": "pt-BR",
	"it":    "it",
	"it-it": "it",
	"ar":    "ar",
	"zh":    "zh-CN",
	"zh-cn": "zh-CN",
	"ja":    "ja-JP",
	"ja-jp": "ja-JP",
	"ko":    "ko",
	"ko-kr": "ko",
}

type checkReq struct {
	Text string `json:"text"`
	Lang string `json:"lang"`
}

type checkResp struct {
	Matches []Match `json:"matches"`
}

// Handler expose POST /api/grammar. Body JSON {text, lang}. Pas de quota au
// lancement — l'appel est déclenché manuellement par le user (bouton).
type Handler struct {
	Client *Client
	// AI : correcteur Claude pour les langues sans support LanguageTool
	// (aiLangs, coréen). nil = ces langues répondent 400 comme avant.
	AI *AIChecker
	// RDB : cache partagé des vérifications. nil = pas de cache. Même
	// contrat que le cache de traductions : clé SHA-256 (texte jamais stocké
	// en clair côté clé), valeur = matches dérivés, aucune identité user.
	RDB *redis.Client
	// sf déduplique les vérifications identiques concurrentes (double-clic,
	// même phrase vérifiée par plusieurs users) : un seul appel LanguageTool,
	// tout le monde reçoit le résultat. Zero value utilisable.
	sf singleflight.Group
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body checkReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	body.Text = strings.TrimSpace(body.Text)
	if body.Text == "" {
		http.Error(w, "text required", http.StatusBadRequest)
		return
	}
	if utf8.RuneCountInString(body.Text) > maxTextRunes {
		http.Error(w, "text too long", http.StatusBadRequest)
		return
	}

	lang, ok := langAliases[strings.ToLower(strings.TrimSpace(body.Lang))]
	if !ok {
		http.Error(w, "invalid lang", http.StatusBadRequest)
		return
	}
	// Langues hors LanguageTool : servies par l'IA, sinon même 400 que si
	// l'alias n'existait pas (le frontend dégrade en « indisponible »).
	_, viaAI := aiLangs[lang]
	if viaAI && !h.AI.Enabled() {
		http.Error(w, "invalid lang", http.StatusBadRequest)
		return
	}

	// Cache : un hit répond immédiatement sans toucher LanguageTool.
	key := cacheKey(body.Text, lang)
	if matches, ok := h.cacheGet(r.Context(), key); ok {
		respond(w, matches)
		return
	}

	// Singleflight sur la clé de cache : les requêtes identiques en vol
	// partagent un seul appel upstream. Contexte détaché volontairement :
	// si le demandeur « leader » annule (navigation), les suiveurs gardent
	// leur résultat et le cache se remplit quand même. Borné par le timeout
	// du client HTTP.
	v, err, _ := h.sf.Do(key, func() (any, error) {
		ctx := context.WithoutCancel(r.Context())
		var matches []Match
		var err error
		if viaAI {
			matches, err = h.AI.Check(ctx, body.Text, lang)
		} else {
			matches, err = h.Client.Check(ctx, body.Text, lang)
		}
		if err != nil {
			return nil, err
		}
		h.cacheSet(ctx, key, matches)
		return matches, nil
	})
	if err != nil {
		http.Error(w, "grammar unavailable", http.StatusBadGateway)
		return
	}
	matches, ok := v.([]Match)
	if !ok {
		http.Error(w, "grammar unavailable", http.StatusBadGateway)
		return
	}
	respond(w, matches)
}

func respond(w http.ResponseWriter, matches []Match) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(checkResp{Matches: matches})
}

// cacheKey : hash du couple langue+texte — le texte n'apparaît jamais en
// clair dans Redis côté clé. La langue résolue (fr-FR, pas fr) fait partie
// de la clé : les alias pointant sur la même variante partagent l'entrée.
func cacheKey(text, lang string) string {
	sum := sha256.Sum256([]byte(lang + "\x00" + text))
	return "grcache:" + hex.EncodeToString(sum[:])
}

// cachedMatches : forme compacte stockée dans Redis. Un texte sans faute est
// cachable aussi (M vide) — c'est même le cas le plus fréquent.
type cachedMatches struct {
	M []Match `json:"m"`
}

// cacheGet / cacheSet : best-effort, jamais bloquants pour la requête (une
// erreur Redis dégrade en simple cache-miss).
func (h *Handler) cacheGet(ctx context.Context, key string) ([]Match, bool) {
	if h.RDB == nil {
		return nil, false
	}
	raw, err := h.RDB.Get(ctx, key).Result()
	if err != nil {
		return nil, false
	}
	var c cachedMatches
	if json.Unmarshal([]byte(raw), &c) != nil || c.M == nil {
		return nil, false
	}
	return c.M, true
}

func (h *Handler) cacheSet(ctx context.Context, key string, matches []Match) {
	if h.RDB == nil || matches == nil {
		return
	}
	raw, err := json.Marshal(cachedMatches{M: matches})
	if err != nil {
		return
	}
	_ = h.RDB.Set(ctx, key, raw, cacheTTL).Err()
}
