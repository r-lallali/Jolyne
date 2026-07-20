package translate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/analytics"
	"github.com/ralys/jolyne/backend/internal/quota"
)

// Limite de payload défensive. La traduction côté UI cible un mot ou une
// phrase courte sélectionnée par le user — pas un roman.
const maxTextRunes = 500

// TTL du cache de traductions. Les mots reviennent souvent (mêmes bases de
// vocabulaire) — un hit ne consomme ni LibreTranslate/Claude ni le quota.
const cacheTTL = 7 * 24 * time.Hour

// Liste des langues supportées. On accepte aussi `auto` pour la source.
var allowedLangs = map[string]struct{}{
	"auto": {},
	"fr":   {}, "en": {}, "es": {}, "de": {}, "pt": {}, "it": {},
	"zh": {}, "ja": {}, "ko": {}, "ar": {},
}

type translateReq struct {
	Text   string `json:"text"`
	Source string `json:"source"`
	Target string `json:"target"`
}

type translateResp struct {
	Translated string `json:"translated"`
	// Langue source détectée (LibreTranslate quand source == "auto",
	// Claude sur le chemin IA). Vide si non détectée. Permet au popover
	// d'afficher la vraie langue et au carnet de vocab de stocker un code
	// exploitable plutôt que "auto".
	Detected string `json:"detected,omitempty"`
	// Romanisation du texte source (pinyin, rōmaji…) — chemin IA et
	// sources zh/ja/ko/ar uniquement.
	Romanization string `json:"romanization,omitempty"`
}

// Anti-abus : les traductions sont ILLIMITÉES pour tous les plans (choix
// produit — comprendre son partenaire est le cœur du service), mais le débit
// par identité reste borné pour protéger le budget upstream d'un scraper.
// Invisible pour un humain, même en mode immersion (file séquentielle).
const (
	burstLimit  = 300
	burstWindow = 5 * time.Minute
)

// Handler expose POST /api/translate. Body JSON {text, source, target}.
// Traductions illimitées quel que soit le plan ; seul le garde-fou anti-abus
// ci-dessus peut renvoyer 429 (identité = userID si connecté, sinon
// fingerprint via l'en-tête X-Device-FP).
//
// Routage : mots isolés → LibreTranslate (instantané, gratuit) ; phrases →
// Claude Haiku si configuré (qualité nettement supérieure, Argos pivotant
// par l'anglais), avec repli LibreTranslate sur erreur IA.
type Handler struct {
	Client *Client
	// AI : traducteur Claude pour les phrases. nil = LibreTranslate seul.
	AI *AITranslator
	// RDB : cache partagé des traductions. nil = pas de cache. La clé est
	// un hash SHA-256 (texte jamais stocké en clair côté clé), la valeur ne
	// contient que la traduction dérivée — aucune identité utilisateur.
	RDB *redis.Client
	// Quota : moteur du rate-limit anti-abus (Allow). nil = pas de limite (dev).
	Quota *quota.Engine
	// ResolveUserID résout le cookie de session → userID (0 si anonyme).
	// Optionnel : nil → identité par fingerprint seulement.
	ResolveUserID func(r *http.Request) int64
	// Tracker : event translate_used (funnel). Optionnel, nil-safe.
	Tracker *analytics.Tracker
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body translateReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024)).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	body.Text = strings.TrimSpace(body.Text)
	body.Source = strings.ToLower(strings.TrimSpace(body.Source))
	body.Target = strings.ToLower(strings.TrimSpace(body.Target))

	if body.Text == "" {
		http.Error(w, "text required", http.StatusBadRequest)
		return
	}
	if utf8.RuneCountInString(body.Text) > maxTextRunes {
		http.Error(w, "text too long", http.StatusBadRequest)
		return
	}
	if _, ok := allowedLangs[body.Source]; !ok {
		http.Error(w, "invalid source", http.StatusBadRequest)
		return
	}
	if body.Target == "auto" {
		http.Error(w, "invalid target", http.StatusBadRequest)
		return
	}
	if _, ok := allowedLangs[body.Target]; !ok {
		http.Error(w, "invalid target", http.StatusBadRequest)
		return
	}

	userID := int64(0)
	if h.ResolveUserID != nil {
		userID = h.ResolveUserID(r)
	}
	quotaID := quota.Identity(userID, strings.TrimSpace(r.Header.Get("X-Device-FP")))

	// Cache : un hit répond immédiatement sans mobiliser l'upstream — il
	// échappe aussi au rate-limit (coût quasi nul, autant servir).
	key := cacheKey(body.Text, body.Source, body.Target)
	if cached, ok := h.cacheGet(r.Context(), key); ok {
		h.respond(w, cached)
		h.track(r, userID, body.Source, body.Target)
		return
	}

	// Garde-fou anti-abus AVANT l'appel upstream (cf. burstLimit). Fail-open
	// sur erreur Redis — Allow s'en charge.
	if h.Quota != nil && quotaID != "" {
		if ok, _ := h.Quota.Allow(r.Context(), "translate_burst", quotaID, burstLimit, burstWindow); !ok {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			_ = json.NewEncoder(w).Encode(map[string]string{"code": "rate_limited"})
			return
		}
	}

	// Routage : phrases → IA (avec repli LibreTranslate), mots → LibreTranslate.
	var result Result
	var err error
	if h.AI.Enabled() && isPhrase(body.Text) {
		result, err = h.AI.Translate(r.Context(), body.Text, body.Source, body.Target)
		if err != nil {
			result, err = h.translateLT(r.Context(), body.Text, body.Source, body.Target)
		}
	} else {
		result, err = h.translateLT(r.Context(), body.Text, body.Source, body.Target)
	}
	if err != nil {
		http.Error(w, "translation unavailable", http.StatusBadGateway)
		return
	}

	h.cacheSet(r.Context(), key, result)
	h.respond(w, result)
	h.track(r, userID, body.Source, body.Target)
}

// track émet l'event translate_used — métadonnées seulement (langues,
// identité hashée), jamais le texte (règle d'or #1).
func (h *Handler) track(r *http.Request, userID int64, source, target string) {
	h.Tracker.Emit(analytics.Event{
		Name:     analytics.EventTranslateUsed,
		UserID:   userID,
		AnonID:   analytics.HashID(strings.TrimSpace(r.Header.Get("X-Device-FP"))),
		LangFrom: source,
		LangTo:   target,
	})
}

// translateLT appelle LibreTranslate avec un garde-fou : si la sortie est
// identique à l'entrée alors que la source était explicite, la langue
// annoncée était probablement fausse (ex. du chinois annoncé "en") — on
// re-tente UNE fois en détection auto et on ne garde ce résultat que s'il
// diffère réellement de l'entrée.
func (h *Handler) translateLT(ctx context.Context, text, source, target string) (Result, error) {
	res, err := h.Client.Translate(ctx, text, source, target)
	if err != nil {
		return Result{}, err
	}
	if source != "auto" && sameText(res.Translated, text) {
		if retry, rerr := h.Client.Translate(ctx, text, "auto", target); rerr == nil &&
			!sameText(retry.Translated, text) {
			return retry, nil
		}
	}
	return res, nil
}

func (h *Handler) respond(w http.ResponseWriter, result Result) {
	w.Header().Set("Content-Type", "application/json")
	// Conversion directe : Result et translateResp partagent les mêmes
	// champs, seuls les tags JSON diffèrent.
	_ = json.NewEncoder(w).Encode(translateResp(result))
}

// isPhrase : heuristique de routage vers le traducteur IA. Le texte arrive
// trimé, donc tout blanc restant = multi-mots ; un segment CJK sans espaces
// de ≥ 12 runes est aussi traité comme une phrase.
func isPhrase(text string) bool {
	if strings.IndexFunc(text, unicode.IsSpace) >= 0 {
		return true
	}
	return utf8.RuneCountInString(text) >= 12
}

func sameText(a, b string) bool {
	return strings.EqualFold(strings.TrimSpace(a), strings.TrimSpace(b))
}

// cacheKey : hash du triplet — le texte n'apparaît jamais en clair dans
// Redis côté clé, et la valeur ne porte aucune identité utilisateur.
func cacheKey(text, source, target string) string {
	sum := sha256.Sum256([]byte(source + "\x00" + target + "\x00" + text))
	return "trcache:" + hex.EncodeToString(sum[:])
}

// cachedResult : forme compacte stockée dans Redis.
type cachedResult struct {
	T string `json:"t"`
	D string `json:"d,omitempty"`
	R string `json:"r,omitempty"`
}

// cacheGet / cacheSet : best-effort, jamais bloquants pour la requête (une
// erreur Redis dégrade en simple cache-miss).
func (h *Handler) cacheGet(ctx context.Context, key string) (Result, bool) {
	if h.RDB == nil {
		return Result{}, false
	}
	raw, err := h.RDB.Get(ctx, key).Result()
	if err != nil {
		return Result{}, false
	}
	var c cachedResult
	if json.Unmarshal([]byte(raw), &c) != nil || c.T == "" {
		return Result{}, false
	}
	return Result{Translated: c.T, Detected: c.D, Romanization: c.R}, true
}

func (h *Handler) cacheSet(ctx context.Context, key string, res Result) {
	if h.RDB == nil || res.Translated == "" {
		return
	}
	raw, err := json.Marshal(cachedResult{T: res.Translated, D: res.Detected, R: res.Romanization})
	if err != nil {
		return
	}
	_ = h.RDB.Set(ctx, key, raw, cacheTTL).Err()
}
