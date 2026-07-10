package moderation

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"unicode"

	"github.com/ralys/jolyne/backend/internal/claudeapi"
)

// Classifier évalue la toxicité d'un message via Claude — couche nuancée qui
// complète la blocklist statique (laquelle reste le filtre instantané, zéro
// latence, sur les termes évidents). Le classifieur attrape ce qu'une liste de
// mots rate : harcèlement contextuel, menaces déguisées, incitation, insultes
// détournées, quelle que soit la langue.
//
// Il n'est JAMAIS sur le chemin critique du chat : le caller l'invoque en
// arrière-plan (le message est déjà relayé). Aucun contenu n'est loggé
// (règle d'or #1) — seul le verdict l'est éventuellement.
//
// Cascade de coût : (1) pré-filtre gratuit (message sans aucune lettre =
// sain), (2) scorer supervisé local si branché — un score sous SkipBelow
// court-circuite Claude, (3) Claude pour tout le reste. Le scorer réduit le
// volume d'appels API sans jamais décider seul d'une sanction : au moindre
// doute (score au-dessus du seuil, erreur sidecar), Claude tranche comme
// avant.
type Classifier struct {
	client *claudeapi.Client
	log    *slog.Logger

	// Scorer : étage supervisé local (sidecar toxicity-scorer). nil = la
	// cascade se réduit à pré-filtre + Claude.
	Scorer *LocalScorer
	// SkipBelow : score local en-deçà duquel le message est jugé sain sans
	// appel Claude. ≤ 0 → defaultSkipBelow.
	SkipBelow float64
	// Observe : hook de télémétrie sur l'étage qui a tranché
	// ("prefilter", "local_clean", "claude", "scorer_error"). Optionnel.
	Observe func(stage string)
}

// defaultSkipBelow : seuil volontairement bas — le but est d'écarter les
// messages MANIFESTEMENT sains (l'écrasante majorité du chat), pas de
// remplacer le jugement de Claude sur la zone grise.
const defaultSkipBelow = 0.10

// Verdict : résultat d'une classification. Severity va de 0 (sain) à 3 (grave :
// menace, contenu haineux, sexuel non consenti). Category est un label court
// (harassment, hate, sexual, threat, spam…) purement indicatif.
type Verdict struct {
	Toxic    bool   `json:"toxic"`
	Category string `json:"category"`
	Severity int    `json:"severity"`
}

// NewClassifier : renvoie un classifieur adossé au client Claude. Si le client
// est nil/désactivé, Classify est un no-op renvoyant un verdict sain.
func NewClassifier(client *claudeapi.Client, log *slog.Logger) *Classifier {
	return &Classifier{client: client, log: log}
}

// Enabled : true si un client Claude actif est branché.
func (c *Classifier) Enabled() bool {
	return c != nil && c.client != nil && c.client.Enabled()
}

// toxSystemPrompt cadre strictement la sortie : JSON compact uniquement. On
// demande une échelle de sévérité pour distinguer une vulgarité anodine d'une
// menace réelle — le caller décide du seuil d'action.
const toxSystemPrompt = `Tu es un modérateur de contenu pour une app d'échange linguistique.
On te donne UN message d'un utilisateur. Évalue sa toxicité (harcèlement, haine,
menaces, contenu sexuel non sollicité, incitation, spam malveillant). Une
vulgarité légère ou une taquinerie amicale n'est PAS toxique.

Réponds UNIQUEMENT par un objet JSON compact, sans texte autour :
{"toxic": <bool>, "category": "<harassment|hate|sexual|threat|spam|none>", "severity": <0-3>}
severity: 0 = sain, 1 = limite, 2 = clairement toxique, 3 = grave (menace/haine).`

// Classify renvoie le verdict de toxicité d'un message. Fail-safe : toute
// erreur (réseau, parsing, client désactivé) renvoie un verdict sain — on ne
// bloque jamais un utilisateur sur une incertitude technique.
func (c *Classifier) Classify(ctx context.Context, message string) Verdict {
	if !c.Enabled() {
		return Verdict{}
	}

	// Étage 0 (gratuit) : un message sans aucune lettre (emoji, ponctuation,
	// chiffres) ne peut pas porter de harcèlement textuel — la blocklist
	// statique a déjà vu passer le reste.
	if !hasLetter(message) {
		c.observe("prefilter")
		return Verdict{}
	}

	// Étage 1 (local, gratuit) : scorer supervisé. Sous le seuil → sain sans
	// appel API. Erreur sidecar → on dégrade sur Claude, comportement d'avant.
	if c.Scorer != nil {
		score, err := c.Scorer.Score(ctx, message)
		switch {
		case err != nil:
			c.observe("scorer_error")
			if c.log != nil {
				c.log.Warn("toxicity local score failed", "err", err)
			}
		case score < c.skipBelow():
			c.observe("local_clean")
			return Verdict{}
		}
	}

	// Étage 2 : Claude, juge nuancé de la zone grise.
	c.observe("claude")
	raw, err := c.client.Reply(ctx, toxSystemPrompt, nil, message)
	if err != nil {
		if c.log != nil {
			c.log.Warn("toxicity classify failed", "err", err)
		}
		return Verdict{}
	}
	return parseVerdict(raw)
}

func (c *Classifier) skipBelow() float64 {
	if c.SkipBelow <= 0 {
		return defaultSkipBelow
	}
	return c.SkipBelow
}

func (c *Classifier) observe(stage string) {
	if c.Observe != nil {
		c.Observe(stage)
	}
}

// hasLetter : vrai si le message contient au moins une lettre (toutes
// écritures — latin, hangul, kanji, arabe…).
func hasLetter(s string) bool {
	for _, r := range s {
		if unicode.IsLetter(r) {
			return true
		}
	}
	return false
}

// parseVerdict extrait le premier objet JSON de la réponse et le décode. Un
// modèle bavard peut entourer le JSON de texte — on isole donc `{...}`. Verdict
// sain si rien d'exploitable.
func parseVerdict(raw string) Verdict {
	start := strings.IndexByte(raw, '{')
	end := strings.LastIndexByte(raw, '}')
	if start < 0 || end <= start {
		return Verdict{}
	}
	var v Verdict
	if err := json.Unmarshal([]byte(raw[start:end+1]), &v); err != nil {
		return Verdict{}
	}
	// Cohérence : severity>=1 implique toxic, et on borne la plage.
	if v.Severity < 0 {
		v.Severity = 0
	}
	if v.Severity > 3 {
		v.Severity = 3
	}
	if v.Severity >= 1 {
		v.Toxic = true
	}
	return v
}
