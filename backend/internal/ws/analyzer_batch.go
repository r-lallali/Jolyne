package ws

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ralys/jolyne/backend/internal/claudeapi"
)

// AnalysisBatcher regroupe les analyses post-conversation et les soumet à la
// Message Batches API d'Anthropic : mêmes requêtes, −50 % sur les tokens,
// résultats différés de quelques minutes — invisible pour l'utilisateur, le
// matériau pédagogique (carnet, leçon du jour, CECRL) n'est consommé que bien
// plus tard.
//
// Confidentialité (règle d'or #1) : les transcriptions en attente ne vivent
// QU'EN MÉMOIRE du process — jamais dans Redis ni ailleurs. Au shutdown
// gracieux, la file locale est drainée en appels directs (Drain, budget
// borné) ; un kill brutal ou un lot déjà soumis dont les résultats ne sont
// pas encore arrivés restent perdus : assumé.
type AnalysisBatcher struct {
	Claude *claudeapi.Client
	Log    *slog.Logger

	// FlushEvery : fenêtre de regroupement (défaut 2 min). Un lot part aussi
	// dès que MaxPending (défaut 50) analyses attendent.
	FlushEvery time.Duration
	MaxPending int
	// PollEvery / PollTimeout : cadence et budget du polling d'un lot soumis
	// (défauts 30 s / 45 min — les lots passent généralement en minutes).
	PollEvery   time.Duration
	PollTimeout time.Duration

	mu      sync.Mutex
	pending []analysisJob
	kick    chan struct{} // signal de flush anticipé (MaxPending atteint)
	seq     atomic.Int64
}

// analysisJob : une analyse en attente. La transcription (convo) reste dans
// cette struct en mémoire jusqu'à la soumission du lot.
type analysisJob struct {
	customID string
	system   string
	convo    string
	apply    func(ctx context.Context, raw string)
}

func (b *AnalysisBatcher) flushEvery() time.Duration {
	if b.FlushEvery <= 0 {
		return 2 * time.Minute
	}
	return b.FlushEvery
}

func (b *AnalysisBatcher) maxPending() int {
	if b.MaxPending <= 0 {
		return 50
	}
	return b.MaxPending
}

func (b *AnalysisBatcher) pollEvery() time.Duration {
	if b.PollEvery <= 0 {
		return 30 * time.Second
	}
	return b.PollEvery
}

func (b *AnalysisBatcher) pollTimeout() time.Duration {
	if b.PollTimeout <= 0 {
		return 45 * time.Minute
	}
	return b.PollTimeout
}

// Enqueue ajoute une analyse au prochain lot. `apply` sera invoqué avec la
// réponse brute de Claude quand le lot aura abouti.
func (b *AnalysisBatcher) Enqueue(system, convo string, apply func(ctx context.Context, raw string)) {
	b.mu.Lock()
	b.pending = append(b.pending, analysisJob{
		customID: fmt.Sprintf("an-%d", b.seq.Add(1)),
		system:   system,
		convo:    convo,
		apply:    apply,
	})
	full := len(b.pending) >= b.maxPending()
	kick := b.kick
	b.mu.Unlock()
	if full && kick != nil {
		select {
		case kick <- struct{}{}:
		default: // flush déjà demandé
		}
	}
}

// Start lance la boucle de regroupement. À l'arrêt (ctx annulé), la boucle
// s'éteint mais la file est CONSERVÉE : c'est Drain (appelé après le
// shutdown HTTP) qui la vide en appels directs.
func (b *AnalysisBatcher) Start(ctx context.Context) {
	b.mu.Lock()
	if b.kick == nil {
		b.kick = make(chan struct{}, 1)
	}
	b.mu.Unlock()

	go func() {
		ticker := time.NewTicker(b.flushEvery())
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				b.mu.Lock()
				remaining := len(b.pending)
				b.mu.Unlock()
				if remaining > 0 && b.Log != nil {
					b.Log.Info("analysis batcher stopped", "pending", remaining)
				}
				return
			case <-ticker.C:
			case <-b.kick:
			}
			b.flush(ctx)
		}
	}()
}

// Drain exécute en appels directs les analyses encore en file, dans la
// limite du budget ctx (grâce de shutdown). À appeler APRÈS
// http.Server.Shutdown : plus rien n'alimente la file. Les lots déjà soumis
// à la Batch API sont perdus — leurs résultats ne peuvent être appliqués que
// par un process vivant. Parallélisme borné pour ne pas rafaler l'API.
func (b *AnalysisBatcher) Drain(ctx context.Context) {
	b.mu.Lock()
	jobs := b.pending
	b.pending = nil
	b.mu.Unlock()
	if len(jobs) == 0 {
		return
	}

	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	var done atomic.Int64
	for _, j := range jobs {
		if ctx.Err() != nil {
			break // budget épuisé — le reste est compté comme perdu
		}
		sem <- struct{}{}
		wg.Add(1)
		go func(j analysisJob) { //nolint:gosec // G118 : drain post-shutdown, contexte requête déjà mort
			defer wg.Done()
			defer func() { <-sem }()
			callCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
			raw, err := b.Claude.Reply(callCtx, j.system, nil, j.convo)
			cancel()
			if err != nil {
				return
			}
			// L'apply écrit en base : contexte frais, indépendant du budget
			// restant (l'appel IA a déjà été payé, autant persister).
			applyCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			j.apply(applyCtx, raw)
			cancel()
			done.Add(1)
		}(j)
	}
	wg.Wait()
	if b.Log != nil {
		b.Log.Info("analysis batcher drained",
			"done", done.Load(), "dropped", int64(len(jobs))-done.Load())
	}
}

// flush soumet les analyses en attente en un lot, puis suit ce lot dans une
// goroutine dédiée (le regroupement continue pendant le polling). Si la
// soumission échoue, on dégrade en appels directs — plus cher mais l'analyse
// n'est pas perdue.
func (b *AnalysisBatcher) flush(ctx context.Context) {
	b.mu.Lock()
	jobs := b.pending
	b.pending = nil
	b.mu.Unlock()
	if len(jobs) == 0 {
		return
	}

	items := make([]claudeapi.BatchItem, 0, len(jobs))
	byID := make(map[string]analysisJob, len(jobs))
	for _, j := range jobs {
		items = append(items, claudeapi.BatchItem{
			CustomID: j.customID,
			System:   j.system,
			UserMsg:  j.convo,
		})
		byID[j.customID] = j
	}

	submitCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	batchID, err := b.Claude.SubmitBatch(submitCtx, items)
	cancel()
	if err != nil {
		if b.Log != nil {
			b.Log.Warn("analysis batch submit failed — fallback direct", "err", err, "jobs", len(jobs))
		}
		b.runDirect(ctx, jobs)
		return
	}
	if b.Log != nil {
		b.Log.Info("analysis batch submitted", "id", batchID, "jobs", len(jobs))
	}
	go b.follow(ctx, batchID, byID) //nolint:gosec // G118 : polling du lot asynchrone voulu
}

// follow polle le lot jusqu'à complétion puis applique les résultats.
func (b *AnalysisBatcher) follow(ctx context.Context, batchID string, byID map[string]analysisJob) {
	deadline := time.Now().Add(b.pollTimeout())
	ticker := time.NewTicker(b.pollEvery())
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		if time.Now().After(deadline) {
			if b.Log != nil {
				b.Log.Warn("analysis batch timeout", "id", batchID, "jobs", len(byID))
			}
			return
		}
		pollCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		ended, err := b.Claude.BatchEnded(pollCtx, batchID)
		cancel()
		if err != nil {
			if b.Log != nil {
				b.Log.Warn("analysis batch poll failed", "id", batchID, "err", err)
			}
			continue // re-tentera au tick suivant
		}
		if !ended {
			continue
		}

		resCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
		results, err := b.Claude.BatchResults(resCtx, batchID)
		cancel()
		if err != nil {
			if b.Log != nil {
				b.Log.Warn("analysis batch results failed", "id", batchID, "err", err)
			}
			return
		}
		for id, job := range byID {
			raw, ok := results[id]
			if !ok {
				continue // requête en échec côté API — analyse abandonnée
			}
			applyCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			job.apply(applyCtx, raw)
			cancel()
		}
		if b.Log != nil {
			b.Log.Info("analysis batch applied", "id", batchID, "ok", len(results), "jobs", len(byID))
		}
		return
	}
}

// runDirect : repli sur des appels synchrones classiques quand la soumission
// du lot échoue (API batches indisponible…). Séquentiel — quelques analyses
// par fenêtre de flush, pas de rafale.
func (b *AnalysisBatcher) runDirect(ctx context.Context, jobs []analysisJob) {
	for _, j := range jobs {
		callCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		raw, err := b.Claude.Reply(callCtx, j.system, nil, j.convo)
		cancel()
		if err != nil {
			if b.Log != nil {
				b.Log.Warn("analysis direct fallback failed", "err", err)
			}
			continue
		}
		applyCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		j.apply(applyCtx, raw)
		cancel()
	}
}
