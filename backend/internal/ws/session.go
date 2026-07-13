package ws

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/ralys/jolyne/backend/internal/analytics"
	"github.com/ralys/jolyne/backend/internal/matcher"
	"github.com/ralys/jolyne/backend/internal/quota"
	"github.com/ralys/jolyne/backend/internal/session"
)

// runSession est la boucle d'états : (try match → in-chat → next) en tournant.
// Toute sortie passe par les defers en amont.
//
// `lastPeer` conserve le sessionID du dernier peer matché. Passé à TryMatch
// pour empêcher d'être ré-apparié immédiatement avec la même personne.
func (h *Handler) runSession(ctx context.Context, conn *Conn, sess session.Session, wakeup <-chan WakeupEvent, botMode bool) {
	speaks, wants := matcher.LangCode(sess.Speaks), matcher.LangCode(sess.Wants)
	var lastPeer string

	// Identité de quota : userID si connecté, sinon fingerprint device.
	quotaID := quota.Identity(sess.UserID, sess.Fingerprint)

	// Throttle anti-farming sur Next : 1 par seconde max et par session.
	// Variable de scope runSession pour persister à travers les itérations
	// du loop (entre deux chats).
	var lastNextAt time.Time
	canNext := func() bool {
		now := time.Now()
		if now.Sub(lastNextAt) < nextMinInterval {
			return false
		}
		lastNextAt = now
		return true
	}

search:
	for {
		// Salle d'attente : un évènement de réveil peut être resté en buffer
		// si on a quitté la conversation précédente à l'instant exact où il
		// arrivait. On l'écarte proprement plutôt que d'entrer dans une room
		// morte : Left au bot (il se termine), ghost Left à l'humain (il
		// re-queue aussitôt au lieu d'attendre dans le vide).
		select {
		case ev, ok := <-wakeup:
			if !ok {
				return
			}
			h.dismissWakeup(ctx, sess.ID, ev)
		default:
		}

		// Mode prof IA direct : le user a coché "Prof IA" sur l'écran de
		// setup. On court-circuite le matching humain et on lance un bot tout
		// de suite. Le bot consomme son propre quota (50 msg/j en Free) et ne
		// touche pas au crédit swipe — d'où le `continue` qui re-boucle sans
		// passer par le pré-check ci-dessous.
		if botMode && h.d.Bot != nil && h.d.Bot.Enabled() {
			// Pré-check quota prof IA (Free uniquement) AVANT de lancer le bot :
			// inutile de réveiller un prof qui dira aussitôt « limite atteinte »
			// puis repartira (ce qui bouclerait à chaque Next). On renvoie une
			// erreur terminale dédiée → le front présente le paywall Premium.
			if sess.Plan != session.PlanPremium {
				used, err := h.d.Quota.Used(ctx, quota.KindBot, quotaID)
				if err != nil {
					h.d.Log.Warn("bot quota used check", "err", err)
				} else if used >= quota.FreeBotDaily {
					conn.Send(ServerFrame{Type: ServerError, Code: ErrCodeBotQuotaExceeded})
					return
				}
			}
			// SpawnNow réveille notre session via Hub.Wakeup (IsBot=true) PUIS
			// bloque le temps de la conversation côté bot — donc en goroutine.
			// Il ne renvoie `false` (immédiatement, sans Wakeup) que si l'IA
			// est saturée ; dans ce cas on se rabat sur le matching humain.
			spawned := make(chan bool, 1)
			go func() { spawned <- h.d.Bot.SpawnNow(ctx, sess) }()
			select {
			case ev, ok := <-wakeup:
				if !ok {
					return
				}
				// Pas de salle d'attente ici : le user a explicitement choisi
				// le prof IA, il n'est inscrit dans aucune file (humanArrival nil).
				exit, _ := h.runChat(ctx, conn, sess, chatPeer{
					ID:    ev.PeerID,
					Nick:  ev.PeerNick,
					IsBot: true,
					Local: ev.Local,
				}, ev.RoomID, canNext, nil)
				if exit == chatDisconnect {
					return
				}
				// chatNext / chatPeerLeft : on re-boucle → nouveau prof IA.
				continue
			case <-spawned:
				// Échec immédiat (capacité saturée) — aucun Wakeup émis. On
				// laisse tomber dans le flow humain ci-dessous pour ne pas
				// laisser le user coincé.
			case <-ctx.Done():
				return
			case <-conn.Done():
				return
			}
		}

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

		// Score de file : priorise les peers authentifiés/Premium sans affamer
		// les autres (l'attente réelle domine — cf. matcher.MatchScore).
		score := matcher.MatchScore(time.Now(), sess.UserID > 0, sess.Plan == session.PlanPremium)
		out, err := h.d.Matcher.TryMatch(ctx, speaks, wants, sess.ID, lastPeer, score, sess.CEFR)
		if err != nil {
			h.d.Log.Error("matcher error", "err", err)
			conn.Send(ServerFrame{Type: ServerError, Code: ErrCodeInternal})
			return
		}

		var peerID, peerNick, peerFingerprint, peerIPHash, roomID string
		var peerUserID int64
		var peerIsBot bool
		var peerLocal *localRoom
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
			// Bot prof IA : arme un timer 10s. Si personne ne match avant, le
			// bot occupe l'attente (salle d'attente) et réveille notre user via
			// Hub.Wakeup (qui débloque le `<-wakeup` ci-dessous). Le user RESTE
			// dans la file : un humain peut interrompre la conversation bot.
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
				peerLocal = ev.Local
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

		// Conversation(s) : une salle d'attente bot peut être interrompue par
		// l'arrivée d'un humain — on enchaîne alors sur lui dans cette boucle
		// interne, sans repasser par la file (il nous en a déjà sortis).
		for {
			lastPeer = peerID

			// Auto-block sur signalement : si on a déjà reporté ce peer dans une
			// session passée, on bail immédiatement. On ouvre brièvement la room
			// pour envoyer un Left au peer (qui re-queue), puis on re-loop.
			// Jamais pour un bot : pas de fingerprint à bloquer, et ghostMatch
			// publierait dans une room Redis que le bot (transport local) n'écoute pas.
			if h.d.Blocking != nil && !peerIsBot {
				blocked, err := h.d.Blocking.IsBlocked(ctx, sess.Fingerprint, peerFingerprint)
				if err != nil {
					h.d.Log.Warn("blocking check failed", "err", err)
				} else if blocked {
					ghostMatch(ctx, h.d.RDB, roomID, sess.ID)
					continue search
				}
			}

			// Décompte 1 crédit dès qu'un partenaire HUMAIN est sécurisé — y
			// compris celui qui interrompt une salle d'attente. Le bot prof IA
			// ne consomme rien (il est limité séparément, 50 msg/j).
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

			peerType := "human"
			if peerIsBot {
				peerType = "bot"
			}
			h.d.Tracker.Emit(analytics.Event{
				Name:      analytics.EventMatchFound,
				UserID:    sess.UserID,
				SessionID: sess.ID,
				LangFrom:  string(speaks),
				LangTo:    string(wants),
				IPHash:    sess.IPHash,
				Props:     map[string]any{"peer": peerType},
			})

			// Salle d'attente : pendant une conversation bot issue de la file,
			// le user y est TOUJOURS inscrit — runChat écoute le canal wakeup
			// et bascule si un humain le matche. Jamais pour un peer humain ni
			// pour le mode Prof IA direct (géré plus haut, hors file).
			var humanArrival <-chan WakeupEvent
			if peerIsBot {
				humanArrival = wakeup
			}

			convStart := time.Now()
			exit, humanEv := h.runChat(ctx, conn, sess, chatPeer{
				ID:          peerID,
				Nick:        peerNick,
				Fingerprint: peerFingerprint,
				IPHash:      peerIPHash,
				IsBot:       peerIsBot,
				UserID:      peerUserID,
				Local:       peerLocal,
			}, roomID, canNext, humanArrival)
			h.d.Tracker.Emit(analytics.Event{
				Name:      analytics.EventConversationEnded,
				UserID:    sess.UserID,
				SessionID: sess.ID,
				Props: map[string]any{
					"peer":       peerType,
					"duration_s": int(time.Since(convStart).Seconds()),
				},
			})
			switch exit {
			case chatDisconnect:
				return
			case chatHumanArrived:
				// L'humain nous a sortis de la file en nous poppant : on
				// enchaîne sur sa conversation. Block-list et crédit swipe
				// sont re-déroulés au tour suivant de cette boucle.
				peerID = humanEv.PeerID
				peerNick = humanEv.PeerNick
				peerFingerprint = humanEv.PeerFingerprint
				peerIPHash = humanEv.PeerIPHash
				peerUserID = humanEv.PeerUserID
				peerIsBot = humanEv.IsBot
				peerLocal = humanEv.Local
				roomID = humanEv.RoomID
				continue
			default:
				// chatNext / chatPeerLeft. Sortie de salle d'attente : on se
				// retire de la file avant de re-boucler (TryMatch ré-inscrira)
				// pour ne pas laisser une entrée fantôme qu'un peer pourrait
				// popper pendant la conversation suivante.
				if humanArrival != nil {
					_ = h.d.Matcher.Cancel(ctx, speaks, wants, sess.ID)
				}
				// On reboucle. Le prochain partenaire humain reconsommera un
				// crédit au moment du match (pré-check en tête de loop).
				continue search
			}
		}
	}
}

// dismissWakeup écarte proprement un évènement de réveil qu'on ne peut plus
// honorer (resté en buffer pendant qu'on quittait une conversation). Le bot
// reçoit un Left sur son transport local et se termine ; le peer humain reçoit
// un ghost Left dans sa room et re-queue aussitôt. Sans ça, l'un ou l'autre
// resterait planté devant une conversation où personne n'arrivera.
func (h *Handler) dismissWakeup(ctx context.Context, selfID string, ev WakeupEvent) {
	if ev.IsBot {
		if ev.Local != nil {
			dctx, cancel := context.WithTimeout(context.Background(), time.Second)
			_ = ev.Local.SendLeft(dctx)
			cancel()
			_ = ev.Local.Close()
		}
		return
	}
	ghostMatch(ctx, h.d.RDB, ev.RoomID, selfID)
}
