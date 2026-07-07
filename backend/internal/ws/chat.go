package ws

import (
	"context"
	"html"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/analytics"
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
	// IsBot = peer est un bot prof IA. Désactive le prompt ami 10-min et
	// l'auto-block on report (pas de fingerprint réel à bloquer).
	IsBot bool
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
	// Démarre le reader de la room AVANT d'annoncer notre présence : ainsi
	// aucun message (greeting du bot prof IA compris) ne peut être émis avant
	// qu'on ne soit prêt à le consommer. Puis on publie `join` — signal que le
	// bot attend pour envoyer son greeting (sinon il publierait dans le vide,
	// pub/sub ne bufferisant pas → prof IA muet). `join` est ignoré par un
	// peer humain (kind absent du switch de la boucle).
	peerCh := room.Channel()
	// Un join perdu = le bot prof IA n'a pas de signe de présence et part sur
	// son timer de repli — si ce log apparaît, c'est le maillon à creuser.
	if err := room.SendJoin(ctx); err != nil {
		h.d.Log.Warn("room join publish", "err", err)
	}

	conn.Send(ServerFrame{Type: ServerMatched, Room: roomID, PeerNick: peer.Nick, IsBot: peer.IsBot})

	// Si le peer est authentifié + qu'on a accès au store profil, on
	// pousse un peer_profile (avatar + prompts) — best-effort, on ne
	// bloque pas le chat si la récup échoue.
	if peer.UserID > 0 && !peer.IsBot && h.d.Profiles != nil {
		h.sendPeerProfile(ctx, conn, peer.UserID)
	}

	// Amorces de conversation fraîches — asynchrone, jamais bloquant pour le
	// match. Pas avec un bot : le prof IA ouvre déjà la conversation lui-même.
	if !peer.IsBot && h.d.Icebreakers.Enabled() {
		go h.d.Icebreakers.Serve(conn, sess.Wants)
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

	// Analyse IA en fin de conversation → carnet de vocabulaire + items de
	// révision + niveau CECRL (comptes authentifiés). Détachée, hors chemin
	// critique : lit `captured` (snapshot copié) à la sortie de runChat,
	// quelle que soit la voie de sortie.
	if h.d.Analyzer.Enabled() && sess.UserID > 0 {
		defer func() {
			snapshot := append([]reports.CapturedMessage(nil), captured...)
			go h.d.Analyzer.Analyze(sess.UserID, sess.Pseudo, sess.Speaks, sess.Wants, snapshot)
		}()
	}

	// Throttle anti-abus pour les corrections : 1 par session toutes les 3 s.
	var lastCorrectAt time.Time

	// Nudge pédagogique : détection de langue offline sur les messages
	// SORTANTS de l'utilisateur. S'il reste dans sa langue native trop
	// longtemps, on lui glisse un rappel privé (jamais montré au peer).
	nudge := newLangNudge(sess.Speaks, sess.Wants)

	// Tandem 50/50 : session structurée moitié langue A, moitié langue B.
	// Poignée de main mutuelle (même pattern que le prompt ami), puis le côté
	// PROPOSEUR détient le timer des phases et publie switch/end — l'autre
	// côté ne fait que suivre. Si le proposeur tombe, le timer meurt avec sa
	// goroutine : le bandeau se fige côté peer mais le chat continue (assumé).
	tandemProposedByMe := false
	tandemActive := false
	tandemPhase := 0
	var tandemTimer <-chan time.Time
	// Ordre des phases côté proposeur : d'abord SA langue pratiquée, puis sa
	// langue native (qui est celle que le peer pratique — files miroir).
	tandemLangs := [2]string{sess.Wants, sess.Speaks}
	startTandemPhase := func(phase int) {
		lang := tandemLangs[phase-1]
		tandemPhase = phase
		nudge.setTandemLang(lang)
		conn.Send(ServerFrame{
			Type:      ServerTandemSwitch,
			Body:      lang,
			WindowSec: int(tandemPhaseDuration / time.Second),
		})
		if err := room.SendTandemSwitch(ctx, lang); err != nil {
			h.d.Log.Warn("tandem switch publish", "err", err)
		}
		tandemTimer = time.After(tandemPhaseDuration)
	}
	startTandem := func() {
		tandemActive = true
		h.d.Tracker.Emit(analytics.Event{
			Name:      analytics.EventTandemStarted,
			UserID:    sess.UserID,
			SessionID: sess.ID,
			LangFrom:  sess.Speaks,
			LangTo:    sess.Wants,
		})
		startTandemPhase(1)
	}
	endTandem := func() {
		tandemActive = false
		tandemPhase = 0
		tandemProposedByMe = false
		tandemTimer = nil
		nudge.setTandemLang("")
		conn.Send(ServerFrame{Type: ServerTandemEnd})
	}

	// peerGone : le peer a quitté/nexté, on a relayé ServerPeerLeft, mais
	// on reste dans runChat pour attendre que NOTRE client décide (Next →
	// re-queue gratuit, ou disconnect/Quit). Permet d'afficher l'écran de
	// fin de conversation côté client.
	peerGone := false

	// Flow ami 10-min : éligible uniquement si les deux peers sont
	// authentifiés ET que le service Friends est branché. promptTimer
	// déclenche le prompt à 10 min ; promptWindow ferme la fenêtre
	// d'acceptation à T+10min+60s. Acceptances locale + remote tracking.
	// Pas de friend prompt avec un bot — pas d'amitié possible côté DB
	// (le bot n'a pas de UserID).
	friendEligible := h.d.Friends != nil && !peer.IsBot
	var promptTimer <-chan time.Time
	var promptWindow <-chan time.Time
	if friendEligible {
		promptTimer = time.After(friendPromptDelay)
	}
	friendPromptSent := false
	myAccept := false
	peerAccept := false
	friendDone := false

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
		case <-tandemTimer:
			// Fin de phase tandem (côté propriétaire du timer uniquement).
			tandemTimer = nil
			if !tandemActive || peerGone {
				break
			}
			if tandemPhase == 1 {
				startTandemPhase(2)
				break
			}
			// Fin de la phase 2 : session terminée des deux côtés.
			if err := room.SendTandemEnd(ctx); err != nil {
				h.d.Log.Warn("tandem end publish", "err", err)
			}
			endTandem()
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
			case roomKindMission:
				// Mission du scénario roleplay accomplie (bot prof IA).
				conn.Send(ServerFrame{Type: ServerMissionComplete})
			case roomKindTandemPropose:
				if tandemActive {
					break
				}
				if tandemProposedByMe {
					// Proposition croisée = accord mutuel implicite. Un seul
					// côté doit détenir le timer — départage déterministe par
					// ID de session (l'autre côté suivra les switch publiés).
					if sess.ID < peer.ID {
						startTandem()
					}
					break
				}
				conn.Send(ServerFrame{Type: ServerTandemPrompt})
			case roomKindTandemAccept:
				if tandemProposedByMe && !tandemActive {
					startTandem()
				}
			case roomKindTandemSwitch:
				// Côté suiveur : la langue de phase est la vérité publiée.
				nudge.setTandemLang(env.Body)
				conn.Send(ServerFrame{
					Type:      ServerTandemSwitch,
					Body:      env.Body,
					WindowSec: int(tandemPhaseDuration / time.Second),
				})
			case roomKindTandemEnd:
				endTandem()
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
				// Rappel « pratique ta langue cible » — évalué hors de tout
				// appel réseau (détection offline), émis au plus une fois.
				if code := nudge.observe(safe); code != "" {
					conn.Send(ServerFrame{Type: ServerNudge, Code: code})
				}
				// Modération IA hors chemin critique : le message est déjà relayé,
				// on le classe en arrière-plan (avertissement + strikes). Jamais
				// avec un bot prof IA (pas un vrai peer à surveiller).
				if h.d.Toxicity.Enabled() && !peer.IsBot {
					go h.d.Toxicity.Inspect(conn, sess, safe)
				}
				// Analytics : on compte le message (jamais son contenu).
				peerKind := "human"
				if peer.IsBot {
					peerKind = "bot"
				}
				h.d.Tracker.Emit(analytics.Event{
					Name:      analytics.EventMessageSent,
					UserID:    sess.UserID,
					SessionID: sess.ID,
					Props:     map[string]any{"peer": peerKind},
				})
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
				// re-queue. Le crédit swipe n'est décompté qu'au prochain match
				// (1 par nouveau partenaire), pas sur cette sortie.
				return chatPeerLeft
			case ClientNext:
				if !canNext() {
					continue
				}
				// Si le peer est déjà parti, on traite comme chatPeerLeft.
				// Dans les deux cas le crédit swipe est décompté au prochain
				// match (1 par nouveau partenaire humain), pas ici.
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
			case ClientTandemPropose:
				// Pas de tandem avec un prof IA (il ne parle que la langue
				// cible), ni si une session tourne ou est déjà proposée.
				if peer.IsBot || peerGone || tandemActive || tandemProposedByMe {
					continue
				}
				tandemProposedByMe = true
				if err := room.SendTandemPropose(ctx); err != nil {
					h.d.Log.Warn("tandem propose publish", "err", err)
					tandemProposedByMe = false
				}
			case ClientTandemAccept:
				// Accepte la proposition du peer : le proposeur démarre le
				// timer en recevant notre accept. Sans proposition en face,
				// l'accept est simplement ignoré côté peer.
				if peer.IsBot || peerGone || tandemActive || tandemProposedByMe {
					continue
				}
				_ = room.SendTandemAccept(ctx)
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
