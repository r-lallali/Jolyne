package analytics

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Tracker écrit les événements de façon ASYNCHRONE et bufferisée : Emit ne
// bloque jamais le chemin critique (WebSocket, HTTP). Si le buffer est plein,
// l'événement est abandonné plutôt que de ralentir l'app — l'analytics ne doit
// jamais dégrader l'expérience.
//
// Nil-safe : un *Tracker nil est un no-op complet (Postgres absent). Même
// contrat que admin.Bans / crypto.Box ailleurs dans le code.
type Tracker struct {
	pool *pgxpool.Pool
	ch   chan Event
	done chan struct{}
	log  *slog.Logger
}

const (
	bufferSize = 2048
	maxBatch   = 100
	flushEvery = 2 * time.Second
)

// NewTracker démarre le worker d'écriture. Renvoie nil si pool est nil (le
// reste du code traite alors le Tracker comme désactivé).
func NewTracker(pool *pgxpool.Pool, log *slog.Logger) *Tracker {
	if pool == nil {
		return nil
	}
	if log == nil {
		log = slog.Default()
	}
	t := &Tracker{
		pool: pool,
		ch:   make(chan Event, bufferSize),
		done: make(chan struct{}),
		log:  log,
	}
	go t.worker()
	return t
}

// Emit met l'événement en file pour écriture. Non bloquant. Rejette en silence
// (avec un warn) les noms hors allowlist.
func (t *Tracker) Emit(ev Event) {
	if t == nil {
		return
	}
	if !ValidName(ev.Name) {
		t.log.Warn("analytics: event hors allowlist ignoré", "name", ev.Name)
		return
	}
	select {
	case t.ch <- ev:
	default:
		// Buffer saturé : on jette. Compromis assumé (cf. doc du type).
		t.log.Warn("analytics: buffer plein, event abandonné", "name", ev.Name)
	}
}

// Close ferme la file et attend le flush final. Branché sur le defer de main.
func (t *Tracker) Close() {
	if t == nil {
		return
	}
	close(t.ch)
	<-t.done
}

func (t *Tracker) worker() {
	defer close(t.done)
	ticker := time.NewTicker(flushEvery)
	defer ticker.Stop()

	batch := make([]Event, 0, maxBatch)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		t.flush(batch)
		batch = batch[:0]
	}

	for {
		select {
		case ev, ok := <-t.ch:
			if !ok {
				flush()
				return
			}
			batch = append(batch, ev)
			if len(batch) >= maxBatch {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

const insertSQL = `
	INSERT INTO events (ts, name, user_id, anon_id, session_id, lang_from, lang_to, ip_hash, props)
	VALUES (COALESCE($1, now()), $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`

func (t *Tracker) flush(evs []Event) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	b := &pgx.Batch{}
	for _, e := range evs {
		var props any // string JSON ou nil → NULL::jsonb
		if len(e.Props) > 0 {
			if raw, err := json.Marshal(e.Props); err == nil {
				props = string(raw)
			}
		}
		b.Queue(insertSQL,
			nullTime(e.TS), e.Name, nullInt(e.UserID), nullStr(e.AnonID),
			nullStr(e.SessionID), nullStr(e.LangFrom), nullStr(e.LangTo),
			nullStr(e.IPHash), props)
	}

	br := t.pool.SendBatch(ctx, b)
	defer br.Close()
	for range evs {
		if _, err := br.Exec(); err != nil {
			t.log.Warn("analytics: insert event", "err", err)
		}
	}
}

// Helpers : convertissent les valeurs zéro en NULL SQL (nil interface).
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullInt(i int64) any {
	if i == 0 {
		return nil
	}
	return i
}

func nullTime(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t
}
