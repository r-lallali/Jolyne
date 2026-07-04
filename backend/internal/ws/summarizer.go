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

// Summarizer transforme une conversation terminée en entrées de carnet de
// vocabulaire, automatiquement. À la fin d'un chat, Claude relit la
// transcription et en extrait les mots utiles dans la langue apprise, traduits
// vers la langue de l'apprenant — ils atterrissent directement dans le carnet.
//
// Confidentialité : la transcription n'est utilisée que le temps de l'appel
// (jamais persistée ni loggée — règle d'or #1), exactement comme le flux de
// signalement. Réservé aux comptes (le carnet est lié à un user_id) et gated
// par un minimum de messages pour ne pas gaspiller d'appels sur un échange
// trivial.
type Summarizer struct {
	Claude *claudeapi.Client
	// Save persiste un mot du carnet. Découplé du package vocab pour éviter le
	// couplage (l'adaptateur est câblé dans main). term dans sourceLang,
	// translation dans targetLang.
	Save func(ctx context.Context, userID int64, term, translation, sourceLang, targetLang string) error
	Log  *slog.Logger

	// MaxWords : nombre max d'entrées extraites par conversation (défaut 8).
	MaxWords int
	// MinMessages : en-deçà, on ne résume pas (défaut 6).
	MinMessages int
}

// Enabled : actif seulement si Claude répond et qu'un writer carnet est branché.
func (s *Summarizer) Enabled() bool {
	return s != nil && s.Claude.Enabled() && s.Save != nil
}

func (s *Summarizer) maxWords() int {
	if s.MaxWords <= 0 {
		return 8
	}
	return s.MaxWords
}

func (s *Summarizer) minMessages() int {
	if s.MinMessages <= 0 {
		return 6
	}
	return s.MinMessages
}

type vocabItem struct {
	Term        string `json:"term"`
	Translation string `json:"translation"`
}

// Summarize extrait le vocabulaire d'une conversation et l'enregistre dans le
// carnet de l'apprenant. Conçu pour tourner en goroutine détachée à la fin du
// chat — contexte propre borné, aucun retour. `speaks` = langue de l'apprenant,
// `wants` = langue apprise (les termes extraits sont dans `wants`).
func (s *Summarizer) Summarize(userID int64, speaks, wants string, transcript []reports.CapturedMessage) {
	if !s.Enabled() || userID <= 0 || len(transcript) < s.minMessages() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	convo := renderTranscript(transcript)
	system := fmt.Sprintf(`Tu aides un apprenant dont la langue est "%s" à réviser une conversation
d'échange linguistique où il pratique "%s". Relis la transcription et extrais
jusqu'à %d mots ou expressions UTILES en "%s" qui y apparaissent (vocabulaire
qu'un apprenant a intérêt à retenir). Ignore les salutations banales, les noms
propres et les mots outils triviaux.

Réponds UNIQUEMENT par un tableau JSON compact, sans texte autour :
[{"term":"<mot en %s>","translation":"<traduction en %s>"}]
Renvoie [] si rien d'intéressant.`, speaks, wants, s.maxWords(), wants, wants, speaks)

	raw, err := s.Claude.Reply(ctx, system, nil, convo)
	if err != nil {
		if s.Log != nil {
			s.Log.Warn("session summary failed", "err", err)
		}
		return
	}
	items := parseVocabItems(raw, s.maxWords())
	for _, it := range items {
		term := strings.TrimSpace(it.Term)
		tr := strings.TrimSpace(it.Translation)
		if term == "" || tr == "" {
			continue
		}
		// term dans la langue apprise (wants=source), traduction dans la langue
		// de l'apprenant (speaks=target) — même convention que le popover.
		if err := s.Save(ctx, userID, term, tr, wants, speaks); err != nil && s.Log != nil {
			s.Log.Warn("session summary save failed", "err", err)
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

// parseVocabItems isole le tableau JSON de la réponse et le décode, borné à
// max entrées. Renvoie nil si rien d'exploitable (fail-safe).
func parseVocabItems(raw string, max int) []vocabItem {
	start := strings.IndexByte(raw, '[')
	end := strings.LastIndexByte(raw, ']')
	if start < 0 || end <= start {
		return nil
	}
	var items []vocabItem
	if err := json.Unmarshal([]byte(raw[start:end+1]), &items); err != nil {
		return nil
	}
	if len(items) > max {
		items = items[:max]
	}
	return items
}
