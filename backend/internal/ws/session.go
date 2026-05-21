package ws

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/ralys/jolyne/backend/internal/matcher"
	"github.com/ralys/jolyne/backend/internal/quota"
	"github.com/ralys/jolyne/backend/internal/session"
)

// runSession est la boucle d'états : (try match → in-chat → next) en tournant.
// Toute sortie passe par les defers en amont.
//
// `lastPeer` conserve le sessionID du dernier peer matché. Passé à TryMatch
// pour empêcher d'être ré-apparié immédiatement avec la même personne.
func (h *Handler) runSession(ctx context.Context, conn *Conn, sess session.Session, wakeup <-chan WakeupEvent) {
	speaks, wants := matcher.LangCode(sess.Speaks), matcher.LangCode(sess.Wants)
	var lastPeer string

	// Throttle anti-farming sur Next : 1 par seconde max et par session
	// (PLAN.md §4 Phase 1, §6 Contraintes). Variable de scope runSession
	// pour persister à travers les itérations du loop (entre deux chats).
	var lastNextAt time.Time
	canNext := func() bool {
		now := time.Now()
		if now.Sub(lastNextAt) < nextMinInterval {
			return false
		}
		lastNextAt = now
		return true
	}

	for {
		out, err := h.d.Matcher.TryMatch(ctx, speaks, wants, sess.ID, lastPeer)
		if err != nil {
			h.d.Log.Error("matcher error", "err", err)
			conn.Send(ServerFrame{Type: ServerError, Code: ErrCodeInternal})
			return
		}

		var peerID, peerNick, peerFingerprint, peerIPHash, roomID string
		var peerUserID int64
		switch {
		case out.Matched:
			peerID = out.PeerID
			roomID = uuid.NewString()
			peer, ok := h.d.Hub.Lookup(out.PeerID)
			if !ok {
				// Peer disparu entre LPOP et Lookup — on re-tente.
				continue
			}
			peerNick = peer.Pseudo
			peerFingerprint = peer.Fingerprint
			peerIPHash = peer.IPHash
			peerUserID = peer.UserID
			if !h.d.Hub.Wakeup(out.PeerID, WakeupEvent{
				RoomID:          roomID,
				PeerNick:        sess.Pseudo,
				PeerID:          sess.ID,
				PeerFingerprint: sess.Fingerprint,
				PeerIPHash:      sess.IPHash,
				PeerUserID:      sess.UserID,
			}) {
				continue
			}
		default:
			conn.Send(ServerFrame{Type: ServerQueued})
			defer func() { _ = h.d.Matcher.Cancel(ctx, speaks, wants, sess.ID) }()
			select {
			case ev, ok := <-wakeup:
				if !ok {
					return
				}
				roomID = ev.RoomID
				peerNick = ev.PeerNick
				peerID = ev.PeerID
				peerFingerprint = ev.PeerFingerprint
				peerIPHash = ev.PeerIPHash
				peerUserID = ev.PeerUserID
			case <-time.After(queueTimeout):
				_ = h.d.Matcher.Cancel(ctx, speaks, wants, sess.ID)
				conn.Send(ServerFrame{Type: ServerError, Code: ErrCodeQueueTimeout})
				return
			case <-ctx.Done():
				return
			case <-conn.Done():
				return
			}
		}

		lastPeer = peerID

		// Auto-block sur signalement : si on a déjà reporté ce peer dans une
		// session passée, on bail immédiatement. On ouvre brièvement la room
		// pour envoyer un Left au peer (qui re-queue), puis on re-loop.
		if h.d.Blocking != nil {
			blocked, err := h.d.Blocking.IsBlocked(ctx, sess.Fingerprint, peerFingerprint)
			if err != nil {
				h.d.Log.Warn("blocking check failed", "err", err)
			} else if blocked {
				ghostMatch(ctx, h.d.RDB, roomID, sess.ID)
				continue
			}
		}

		exit := h.runChat(ctx, conn, sess, chatPeer{
			ID:          peerID,
			Nick:        peerNick,
			Fingerprint: peerFingerprint,
			IPHash:      peerIPHash,
			UserID:      peerUserID,
		}, roomID, canNext)
		if exit == chatDisconnect {
			return
		}
		if exit == chatNext {
			used, err := h.d.Quota.CheckAndIncrementNext(ctx, sess.Fingerprint, quota.FreeNextDaily)
			if errors.Is(err, quota.ErrQuotaExceeded) {
				conn.Send(ServerFrame{Type: ServerError, Code: ErrCodeQuotaExceeded})
				return
			}
			if err != nil {
				h.d.Log.Error("quota error", "err", err, "used", used)
				conn.Send(ServerFrame{Type: ServerError, Code: ErrCodeInternal})
				return
			}
		}
	}
}
