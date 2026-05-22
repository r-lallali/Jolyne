package ws

import (
	"context"
	"html"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/moderation"
	"github.com/ralys/jolyne/backend/internal/reports"
	"github.com/ralys/jolyne/backend/internal/session"
)

type chatExit int

const (
	chatNext chatExit = iota
	chatPeerLeft
	chatDisconnect
)

// chatPeer regroupe les infos du peer pour cette conversation (utilisées
// notamment lors d'un signalement). UserID > 0 si le peer est authentifié
// — sert au prompt ami 10-min (uniquement éligible si les deux peers le sont).
type chatPeer struct {
	ID          string
	Nick        string
	Fingerprint string
	IPHash      string
	UserID      int64
}

// runChat est la boucle de chat avec un peer. Sort proprement sur "next",
// peer_left ou déconnexion. La room Redis est ouverte ici, fermée au retour.
//
// Maintient un ring buffer des `captureWindow` derniers messages échangés
// (envoyés ET reçus) pour pouvoir les joindre à un éventuel signalement.
//
// Aucun contenu de message n'est loggé — règle d'or #1.
func (h *Handler) runChat(ctx context.Context, conn *Conn, sess session.Session, peer chatPeer, roomID string, canNext func() bool) chatExit {
	room, err := openRoom(ctx, h.d.RDB, roomID, sess.ID)
	if err != nil {
		h.d.Log.Error("room open", "err", err)
		conn.Send(ServerFrame{Type: ServerError, Code: ErrCodeInternal})
		return chatDisconnect
	}
	defer func() {
		sendCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = room.SendLeft(sendCtx)
		_ = room.Close()
	}()
	conn.Send(ServerFrame{Type: ServerMatched, Room: roomID, PeerNick: peer.Nick})

	// Si le peer est authentifié + qu'on a accès au store profil, on
	// pousse un peer_profile (avatar + prompts) — best-effort, on ne
	// bloque pas le chat si la récup échoue.
	if peer.UserID > 0 && h.d.Profiles != nil {
		h.sendPeerProfile(ctx, conn, peer.UserID)
	}

	captured := make([]reports.CapturedMessage, 0, captureWindow)
	push := func(from, body string) {
		captured = append(captured, reports.CapturedMessage{
			From: from,
			Body: body,
			At:   time.Now().UTC().Format(time.RFC3339Nano),
		})
		if len(captured) > captureWindow {
			captured = captured[len(captured)-captureWindow:]
		}
	}

	// Throttle anti-abus pour les corrections : 1 par session toutes les 3 s.
	var lastCorrectAt time.Time

	// peerGone : le peer a quitté/nexté, on a relayé ServerPeerLeft, mais
	// on reste dans runChat pour attendre que NOTRE client décide (Next →
	// re-queue gratuit, ou disconnect/Quit). Permet d'afficher l'écran de
	// fin de conversation côté client.
	peerGone := false

	// Flow ami 10-min : éligible uniquement si les deux peers sont
	// authentifiés ET que le service Friends est branché. promptTimer
	// déclenche le prompt à 10 min ; promptWindow ferme la fenêtre
	// d'acceptation à T+10min+60s. Acceptances locale + remote tracking.
	friendEligible := h.d.Friends != nil
	var promptTimer <-chan time.Time
	var promptWindow <-chan time.Time
	if friendEligible {
		promptTimer = time.After(friendPromptDelay)
	}
	friendPromptSent := false
	myAccept := false
	peerAccept := false
	friendDone := false

	peerCh := room.Channel()
	for {
		select {
		case <-ctx.Done():
			return chatDisconnect
		case <-conn.Done():
			return chatDisconnect
		case <-promptTimer:
			// Émet le prompt aux deux côtés. Chacun déclenche son propre
			// timer 10 min — ils tirent quasi simultanément.
			promptTimer = nil
			if peerGone {
				// Le peer est déjà parti — on n'envoie rien.
				break
			}
			conn.Send(ServerFrame{
				Type:      ServerFriendPrompt,
				PeerNick:  peer.Nick,
				WindowSec: int(friendAcceptWindow / time.Second),
			})
			friendPromptSent = true
			promptWindow = time.After(friendAcceptWindow)
		case <-promptWindow:
			promptWindow = nil
			if friendDone {
				break
			}
			// Fenêtre fermée sans double accept : on prévient le client
			// que le match ami n'a pas eu lieu.
			conn.Send(ServerFrame{Type: ServerFriendSkipped})
		case env, ok := <-peerCh:
			if !ok {
				return chatDisconnect
			}
			if peerGone {
				// Plus rien à relayer une fois que le peer est parti.
				continue
			}
			switch env.Kind {
			case roomKindMsg:
				push(peer.Nick, env.Body)
				conn.Send(ServerFrame{Type: ServerMsg, Body: env.Body, ID: env.ID})
			case roomKindTyping:
				conn.Send(ServerFrame{Type: ServerTyping})
			case roomKindLeft:
				conn.Send(ServerFrame{Type: ServerPeerLeft})
				peerGone = true
			case roomKindCorrection:
				conn.Send(ServerFrame{
					Type:     ServerCorrection,
					TargetID: env.TargetID,
					Original: env.Original,
					Body:     env.Body,
					Note:     env.Note,
				})
			case roomKindFriendAccept:
				peerAccept = true
				if myAccept && !friendDone && friendEligible {
					friendDone = tryMakeFriendsOrPending(ctx, h, conn, sess.UserID, peer.UserID, sess.Fingerprint, peer.Fingerprint)
				}
			}
		case msg, ok := <-conn.Inbound:
			if !ok {
				return chatDisconnect
			}
			switch msg.Type {
			case ClientMsg:
				if peerGone {
					continue
				}
				if len(msg.ID) > msgIDMaxLength {
					conn.Send(ServerFrame{Type: ServerError, Code: ErrCodeInvalidParam})
					continue
				}
				safe, err := moderation.SanitizeAndCheck(msg.Body, h.d.Block)
				if err != nil {
					conn.Send(ServerFrame{Type: ServerError, Code: mapModerationErr(err)})
					continue
				}
				push(sess.Pseudo, safe)
				if err := room.SendMsg(ctx, msg.ID, safe); err != nil {
					h.d.Log.Error("room publish", "err", err)
					return chatDisconnect
				}
			case ClientCorrect:
				if peerGone {
					continue
				}
				if time.Since(lastCorrectAt) < correctMinInterval {
					continue
				}
				if msg.TargetID == "" || len(msg.TargetID) > msgIDMaxLength {
					conn.Send(ServerFrame{Type: ServerError, Code: ErrCodeInvalidParam})
					continue
				}
				corrected, err := moderation.SanitizeAndCheck(msg.Body, h.d.Block)
				if err != nil {
					conn.Send(ServerFrame{Type: ServerError, Code: mapModerationErr(err)})
					continue
				}
				if len(corrected) > correctionTextMax {
					conn.Send(ServerFrame{Type: ServerError, Code: ErrCodeMessageTooLong})
					continue
				}
				// Note + original : pas de filtre obscénités (la note est
				// éditoriale et peut citer des termes "à éviter" ; l'original
				// a déjà été filtré au moment où il a été envoyé). Trim +
				// troncature + escape HTML — défense en profondeur côté
				// serveur (CLAUDE.md règle d'or #2).
				note := html.EscapeString(truncate(strings.TrimSpace(msg.Note), correctionNoteMax))
				original := html.EscapeString(truncate(strings.TrimSpace(msg.Original), correctionTextMax))
				if err := room.SendCorrection(ctx, msg.TargetID, original, corrected, note); err != nil {
					h.d.Log.Error("room correction publish", "err", err)
					return chatDisconnect
				}
				lastCorrectAt = time.Now()
			case ClientTyping:
				if peerGone {
					continue
				}
				_ = room.SendTyping(ctx)
			case ClientReport:
				if h.d.Reports == nil {
					conn.Send(ServerFrame{Type: ServerError, Code: ErrCodeInternal, Message: "signalement désactivé sur ce serveur"})
					continue
				}
				reason := truncate(msg.Body, reasonMaxLength)
				_, err := h.d.Reports.Save(ctx, reports.Report{
					ReporterSession:     sess.ID,
					ReporterFingerprint: sess.Fingerprint,
					ReporterIPHash:      sess.IPHash,
					ReportedSession:     peer.ID,
					ReportedFingerprint: peer.Fingerprint,
					ReportedIPHash:      peer.IPHash,
					ReportedNick:        peer.Nick,
					Reason:              reason,
					Messages:            captured,
				})
				if err != nil {
					h.d.Log.Error("save report", "err", err)
					conn.Send(ServerFrame{Type: ServerError, Code: ErrCodeInternal})
					continue
				}
				// Auto-block : signaler = ne plus jamais matcher cette personne.
				if h.d.Blocking != nil {
					if err := h.d.Blocking.Add(ctx, sess.Fingerprint, peer.Fingerprint); err != nil {
						h.d.Log.Warn("blocking add failed", "err", err)
					}
				}
				conn.Send(ServerFrame{Type: ServerReported})
				// Après signalement on quitte la conv proprement et on
				// re-queue — comme un Next, sans consommer le quota.
				return chatPeerLeft
			case ClientNext:
				if !canNext() {
					continue
				}
				// Si le peer est déjà parti, on traite comme chatPeerLeft
				// (re-queue gratuit, pas de quota). Sinon c'est un Next
				// volontaire qui coûte un slot quotidien.
				if peerGone {
					return chatPeerLeft
				}
				return chatNext
			case ClientFriendAccept:
				// Le client accepte le prompt. Refusé si pas éligible OU
				// pas dans la fenêtre OU peer déjà parti.
				if !friendEligible || !friendPromptSent || friendDone || peerGone {
					continue
				}
				if myAccept {
					continue
				}
				myAccept = true
				_ = room.SendFriendAccept(ctx)
				if peerAccept {
					friendDone = tryMakeFriendsOrPending(ctx, h, conn, sess.UserID, peer.UserID, sess.Fingerprint, peer.Fingerprint)
				}
			}
		}
	}
}

// ghostMatch ouvre la room le temps d'envoyer un Left au peer puis la
// ferme. Utilisé quand on bail un match unilatéralement (auto-block) sans
// passer par runChat — le peer re-queue immédiatement au lieu d'attendre.
func ghostMatch(ctx context.Context, rdb *redis.Client, roomID, selfID string) {
	room, err := openRoom(ctx, rdb, roomID, selfID)
	if err != nil {
		return
	}
	sendCtx, cancel := context.WithTimeout(context.Background(), time.Second)
	_ = room.SendLeft(sendCtx)
	cancel()
	_ = room.Close()
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}
