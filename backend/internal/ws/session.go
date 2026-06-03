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

	// Identité de quota : userID si connecté, sinon fingerprint device.
	quotaID := quota.Identity(sess.UserID, sess.Fingerprint)

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
		// Quota swipe : 1 crédit par nouveau partenaire humain (Free = 10/j,
		// Premium illimité). Pré-check AVANT de mobiliser un peer pour bloquer
		// net au 11e et présenter le paywall sans gâcher de match.
		if sess.Plan != session.PlanPremium {
			used, err := h.d.Quota.Used(ctx, quota.KindNext, quotaID)
			if err != nil {
				h.d.Log.Warn("quota used check", "err", err)
			} else if used >= quota.FreeNextDaily {
				conn.Send(ServerFrame{Type: ServerError, Code: ErrCodeQuotaExceeded})
				return
			}
		}

		out, err := h.d.Matcher.TryMatch(ctx, speaks, wants, sess.ID, lastPeer)
		if err != nil {
			h.d.Log.Error("matcher error", "err", err)
			conn.Send(ServerFrame{Type: ServerError, Code: ErrCodeInternal})
			return
		}

		var peerID, peerNick, peerFingerprint, peerIPHash, roomID string
		var peerUserID int64
		var peerIsBot bool
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
			// Bot prof IA : arme un timer 10s. Si personne ne match avant,
			// le bot prend la main et réveille notre user via Hub.Wakeup
			// (qui débloque le `<-wakeup` ci-dessous).
			if h.d.Bot != nil {
				h.d.Bot.SpawnFor(ctx, sess)
			}
			select {
			case ev, ok := <-wakeup:
				if !ok {
					if h.d.Bot != nil {
						h.d.Bot.Cancel(sess.ID)
					}
					return
				}
				roomID = ev.RoomID
				peerNick = ev.PeerNick
				peerID = ev.PeerID
				peerFingerprint = ev.PeerFingerprint
				peerIPHash = ev.PeerIPHash
				peerUserID = ev.PeerUserID
				peerIsBot = ev.IsBot
				// Si on a été matché avant que le timer bot ne tire (cas
				// nominal humain ou bot lui-même), on annule proprement.
				if h.d.Bot != nil && !peerIsBot {
					h.d.Bot.Cancel(sess.ID)
				}
			case <-time.After(queueTimeout):
				if h.d.Bot != nil {
					h.d.Bot.Cancel(sess.ID)
				}
				_ = h.d.Matcher.Cancel(ctx, speaks, wants, sess.ID)
				conn.Send(ServerFrame{Type: ServerError, Code: ErrCodeQueueTimeout})
				return
			case <-ctx.Done():
				if h.d.Bot != nil {
					h.d.Bot.Cancel(sess.ID)
				}
				return
			case <-conn.Done():
				if h.d.Bot != nil {
					h.d.Bot.Cancel(sess.ID)
				}
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

		// Décompte 1 crédit dès qu'un partenaire HUMAIN est sécurisé. Le bot
		// prof IA ne consomme rien (il est limité séparément, 50 msg/j).
		if sess.Plan != session.PlanPremium && !peerIsBot {
			_, err := h.d.Quota.CheckAndIncrement(ctx, quota.KindNext, quotaID, quota.FreeNextDaily)
			if errors.Is(err, quota.ErrQuotaExceeded) {
				// Limite atteinte entre le pré-check et ici : relâche le peer
				// (il re-queue via Left) puis présente le paywall.
				ghostMatch(ctx, h.d.RDB, roomID, sess.ID)
				conn.Send(ServerFrame{Type: ServerError, Code: ErrCodeQuotaExceeded})
				return
			}
			if err != nil {
				h.d.Log.Error("quota incr", "err", err)
			}
		}

		exit := h.runChat(ctx, conn, sess, chatPeer{
			ID:          peerID,
			Nick:        peerNick,
			Fingerprint: peerFingerprint,
			IPHash:      peerIPHash,
			IsBot:       peerIsBot,
			UserID:      peerUserID,
		}, roomID, canNext)
		if exit == chatDisconnect {
			return
		}
		// exit == chatNext : on reboucle. Le prochain partenaire humain
		// reconsommera un crédit au moment du match (pré-check en tête de loop).
	}
}
