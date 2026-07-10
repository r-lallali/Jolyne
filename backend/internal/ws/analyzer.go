package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"log/slog"
	"strings"
	"time"

	"github.com/ralys/jolyne/backend/internal/claudeapi"
	"github.com/ralys/jolyne/backend/internal/reports"
)

// SessionAnalyzer transforme une conversation terminée en matériau
// d'apprentissage, automatiquement et en UN SEUL appel Claude :
//
//  1. vocabulaire utile → carnet de vocabulaire (comme l'ancien Summarizer) ;
//  2. fautes récurrentes de l'apprenant (forme erronée → corrigée + note)
//     → items de révision consommés par la « leçon du jour » du mode Cours ;
//  3. estimation de niveau CECRL (A1..C2 → échelle 1.0..6.0) → users.cefr_score
//     (lissage EWMA côté store).
//
// Confidentialité : la transcription n'est utilisée que le temps de l'appel
// (jamais persistée ni loggée — règle d'or #1), exactement comme le flux de
// signalement. Seul le matériau pédagogique dérivé est persisté (même statut
// que les vocab_entries). Réservé aux comptes (tout est lié à un user_id) et
// gated par un minimum de messages pour ne pas gaspiller d'appels sur un
// échange trivial.
type SessionAnalyzer struct {
	Claude *claudeapi.Client
	// SaveWord persiste un mot du carnet. Découplé du package vocab pour éviter
	// le couplage (l'adaptateur est câblé dans main). term dans sourceLang,
	// translation dans targetLang.
	SaveWord func(ctx context.Context, userID int64, term, translation, sourceLang, targetLang string) error
	// SaveMistake persiste une faute corrigée de l'apprenant (item de révision
	// pour la leçon du jour). Optionnel — nil = volet fautes ignoré.
	SaveMistake func(ctx context.Context, userID int64, lang, original, corrected, note string) error
	// SaveCEFR pousse l'estimation CECRL (1.0..6.0) vers le profil user.
	// Optionnel — nil = volet niveau ignoré.
	SaveCEFR func(ctx context.Context, userID int64, score float64) error
	// Réactivation SRS en contexte (optionnel, les deux vont ensemble) :
	// DueTerms liste les mots dus du carnet dans la langue apprise ;
	// ReviewInContext note « good » ceux qui apparaissent dans la
	// conversation. Le match texte se fait ici (Go pur) — la transcription
	// ne quitte jamais le package ws.
	DueTerms        func(ctx context.Context, userID int64, lang string) []string
	ReviewInContext func(ctx context.Context, userID int64, lang string, terms []string) error
	Log             *slog.Logger

	// Batcher : si branché, l'appel Claude passe par la Batch API (−50 % sur
	// les tokens, résultat différé de quelques minutes — invisible : le
	// matériau pédagogique n'est consommé que plus tard). nil = appel direct.
	Batcher *AnalysisBatcher

	// MaxWords : nombre max d'entrées de vocabulaire extraites (défaut 8).
	MaxWords int
	// MaxMistakes : nombre max de fautes extraites (défaut 6).
	MaxMistakes int
	// MinMessages : en-deçà, on n'analyse pas (défaut 6).
	MinMessages int
}

// Enabled : actif seulement si Claude répond et qu'un writer carnet est branché.
func (s *SessionAnalyzer) Enabled() bool {
	return s != nil && s.Claude.Enabled() && s.SaveWord != nil
}

func (s *SessionAnalyzer) maxWords() int {
	if s.MaxWords <= 0 {
		return 8
	}
	return s.MaxWords
}

func (s *SessionAnalyzer) maxMistakes() int {
	if s.MaxMistakes <= 0 {
		return 6
	}
	return s.MaxMistakes
}

func (s *SessionAnalyzer) minMessages() int {
	if s.MinMessages <= 0 {
		return 6
	}
	return s.MinMessages
}

type vocabItem struct {
	Term        string `json:"term"`
	Translation string `json:"translation"`
}

type mistakeItem struct {
	Original  string `json:"original"`
	Corrected string `json:"corrected"`
	Note      string `json:"note"`
}

// sessionAnalysis : forme JSON attendue de Claude. `cefr` vide = pas assez de
// matière pour estimer (l'apprenant n'a presque pas écrit en langue cible).
type sessionAnalysis struct {
	Vocab    []vocabItem   `json:"vocab"`
	Mistakes []mistakeItem `json:"mistakes"`
	CEFR     string        `json:"cefr"`
}

// Analyze extrait vocabulaire, fautes et niveau d'une conversation et les
// persiste via les adaptateurs. Conçu pour tourner en goroutine détachée à la
// fin du chat — contexte propre borné, aucun retour. `learnerNick` identifie
// les messages de l'apprenant dans la transcription ; `speaks` = langue de
// l'apprenant, `wants` = langue apprise (termes et fautes sont dans `wants`).
func (s *SessionAnalyzer) Analyze(userID int64, learnerNick, speaks, wants string, transcript []reports.CapturedMessage) {
	if !s.Enabled() || userID <= 0 || len(transcript) < s.minMessages() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	convo := renderTranscript(transcript)

	// Réactivation SRS : un mot du carnet dû qui apparaît dans la conversation
	// (peu importe qui l'a écrit — le lire en contexte compte) vaut une
	// révision « good ». Match texte insensible à la casse, en Go — aucun
	// appel API, aucune fuite de la transcription.
	if s.DueTerms != nil && s.ReviewInContext != nil {
		if due := s.DueTerms(ctx, userID, wants); len(due) > 0 {
			lower := strings.ToLower(convo)
			var used []string
			for _, term := range due {
				if term == "" {
					continue
				}
				if strings.Contains(lower, strings.ToLower(term)) {
					used = append(used, term)
				}
			}
			if len(used) > 0 {
				if err := s.ReviewInContext(ctx, userID, wants, used); err != nil && s.Log != nil {
					s.Log.Warn("session analysis review in context failed", "err", err)
				}
			}
		}
	}
	system := s.buildSystem(learnerNick, speaks, wants)

	// Chemin batch : la requête rejoint le prochain lot (−50 %), le résultat
	// sera appliqué par le batcher via applyAnalysis. La transcription ne vit
	// qu'en mémoire du process, jamais persistée (règle d'or #1).
	if s.Batcher != nil {
		s.Batcher.Enqueue(system, convo, func(ctx context.Context, raw string) {
			s.applyAnalysis(ctx, userID, speaks, wants, raw)
		})
		return
	}

	raw, err := s.Claude.Reply(ctx, system, nil, convo)
	if err != nil {
		if s.Log != nil {
			s.Log.Warn("session analysis failed", "err", err)
		}
		return
	}
	s.applyAnalysis(ctx, userID, speaks, wants, raw)
}

// buildSystem : system prompt de l'analyse (partagé chemins direct et batch).
func (s *SessionAnalyzer) buildSystem(learnerNick, speaks, wants string) string {
	return fmt.Sprintf(`Tu analyses une conversation d'échange linguistique pour aider un apprenant.
L'apprenant signe ses messages "%s", sa langue est "%s" et il pratique "%s".

Produis trois choses :

1. "vocab" : jusqu'à %d mots ou expressions UTILES en "%s" qui apparaissent dans
la conversation (vocabulaire qu'un apprenant a intérêt à retenir). Ignore les
salutations banales, les noms propres et les mots outils triviaux.

2. "mistakes" : jusqu'à %d erreurs de langue commises par "%s" DANS SES MESSAGES
en "%s" (grammaire, conjugaison, vocabulaire mal employé, tournure non
naturelle). Pour chaque erreur : "original" = ce qu'il a écrit (fragment court),
"corrected" = la forme correcte, "note" = explication en UNE phrase en "%s".
Ignore la ponctuation, les majuscules et le style SMS assumé. Tableau vide si
"%s" n'a pas fait d'erreur notable.

3. "cefr" : niveau CECRL estimé de "%s" en "%s" (A1, A2, B1, B2, C1 ou C2),
d'après la richesse et la justesse de SES messages uniquement. Chaîne vide si
"%s" a écrit moins de 3 messages substantiels en "%s".

Réponds UNIQUEMENT par un objet JSON compact, sans texte autour :
{"vocab":[{"term":"<mot en %s>","translation":"<traduction en %s>"}],"mistakes":[{"original":"...","corrected":"...","note":"..."}],"cefr":"B1"}`,
		learnerNick, speaks, wants,
		s.maxWords(), wants,
		s.maxMistakes(), learnerNick, wants, speaks, learnerNick,
		learnerNick, wants, learnerNick, wants,
		wants, speaks)
}

// applyAnalysis parse la réponse de Claude et persiste le matériau dérivé
// (vocab, fautes, CECRL) — commun aux chemins direct et batch.
func (s *SessionAnalyzer) applyAnalysis(ctx context.Context, userID int64, speaks, wants, raw string) {
	analysis := parseAnalysis(raw, s.maxWords(), s.maxMistakes())

	for _, it := range analysis.Vocab {
		term := strings.TrimSpace(it.Term)
		tr := strings.TrimSpace(it.Translation)
		if term == "" || tr == "" {
			continue
		}
		// term dans la langue apprise (wants=source), traduction dans la langue
		// de l'apprenant (speaks=target) — même convention que le popover.
		if err := s.SaveWord(ctx, userID, term, tr, wants, speaks); err != nil && s.Log != nil {
			s.Log.Warn("session analysis vocab save failed", "err", err)
		}
	}

	if s.SaveMistake != nil {
		for _, m := range analysis.Mistakes {
			orig := strings.TrimSpace(m.Original)
			corr := strings.TrimSpace(m.Corrected)
			if orig == "" || corr == "" || orig == corr {
				continue
			}
			if err := s.SaveMistake(ctx, userID, wants, orig, corr, strings.TrimSpace(m.Note)); err != nil && s.Log != nil {
				s.Log.Warn("session analysis mistake save failed", "err", err)
			}
		}
	}

	if s.SaveCEFR != nil {
		if score, ok := cefrScore(analysis.CEFR); ok {
			if err := s.SaveCEFR(ctx, userID, score); err != nil && s.Log != nil {
				s.Log.Warn("session analysis cefr save failed", "err", err)
			}
		}
	}
}

// renderTranscript aplati les messages capturés en texte pour le prompt. On
// dé-échappe le HTML (les bodies sont stockés escapés) pour rendre à Claude le
// texte original.
func renderTranscript(msgs []reports.CapturedMessage) string {
	var b strings.Builder
	for _, m := range msgs {
		b.WriteString(m.From)
		b.WriteString(": ")
		b.WriteString(html.UnescapeString(m.Body))
		b.WriteByte('\n')
	}
	return b.String()
}

// parseAnalysis isole l'objet JSON de la réponse et le décode, borné à
// maxWords/maxMistakes entrées. Renvoie une analyse vide si rien
// d'exploitable (fail-safe).
func parseAnalysis(raw string, maxWords, maxMistakes int) sessionAnalysis {
	start := strings.IndexByte(raw, '{')
	end := strings.LastIndexByte(raw, '}')
	if start < 0 || end <= start {
		return sessionAnalysis{}
	}
	var a sessionAnalysis
	if err := json.Unmarshal([]byte(raw[start:end+1]), &a); err != nil {
		return sessionAnalysis{}
	}
	if len(a.Vocab) > maxWords {
		a.Vocab = a.Vocab[:maxWords]
	}
	if len(a.Mistakes) > maxMistakes {
		a.Mistakes = a.Mistakes[:maxMistakes]
	}
	return a
}

// cefrLabel : conversion inverse — score continu (1.0..6.0) vers le libellé
// CECRL le plus proche. Sert au calibrage du prof IA (le prompt parle en
// niveaux, pas en décimales).
func cefrLabel(score float64) string {
	labels := []string{"A1", "A2", "B1", "B2", "C1", "C2"}
	idx := int(score + 0.5) // arrondi au niveau le plus proche
	if idx < 1 {
		idx = 1
	}
	if idx > 6 {
		idx = 6
	}
	return labels[idx-1]
}

// cefrScore mappe un niveau CECRL texte vers l'échelle numérique 1.0..6.0
// stockée en base. Tolère la casse et les espaces ; ok=false si non reconnu
// (chaîne vide = pas assez de matière → on ne touche pas au score).
func cefrScore(level string) (float64, bool) {
	switch strings.ToUpper(strings.TrimSpace(level)) {
	case "A1":
		return 1, true
	case "A2":
		return 2, true
	case "B1":
		return 3, true
	case "B2":
		return 4, true
	case "C1":
		return 5, true
	case "C2":
		return 6, true
	default:
		return 0, false
	}
}
