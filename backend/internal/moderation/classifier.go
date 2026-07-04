package moderation

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"

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
type Classifier struct {
	client *claudeapi.Client
	log    *slog.Logger
}

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
	raw, err := c.client.Reply(ctx, toxSystemPrompt, nil, message)
	if err != nil {
		if c.log != nil {
			c.log.Warn("toxicity classify failed", "err", err)
		}
		return Verdict{}
	}
	return parseVerdict(raw)
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
