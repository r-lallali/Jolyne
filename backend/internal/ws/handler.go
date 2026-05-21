package ws

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"html"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/bans"
	"github.com/ralys/jolyne/backend/internal/blocking"
	"github.com/ralys/jolyne/backend/internal/friends"
	"github.com/ralys/jolyne/backend/internal/matcher"
	"github.com/ralys/jolyne/backend/internal/moderation"
	"github.com/ralys/jolyne/backend/internal/profile"
	"github.com/ralys/jolyne/backend/internal/quota"
	"github.com/ralys/jolyne/backend/internal/reports"
	"github.com/ralys/jolyne/backend/internal/session"
)

const (
	queueTimeout    = 30 * time.Second
	nextMinInterval = time.Second
	// Nombre max de messages capturés dans la fenêtre glissante pour les
	// signalements. 20 est suffisant pour donner le contexte sans gonfler
	// la table reports.
	captureWindow   = 20
	reasonMaxLength = 500

	// IDs éphémères de messages : générés côté client pour permettre au peer
	// d'ancrer une correction. On les valide en longueur uniquement (pas un
	// secret, juste un opaque). 1-64 chars.
	msgIDMaxLength = 64

	// Throttle anti-abus pour les corrections (1 par 3 s par session).
	correctMinInterval = 3 * time.Second

	// Limites de taille des champs d'une correction.
	correctionTextMax = 2000
	correctionNoteMax = 500

	// Délai avant d'émettre le friend_prompt aux deux peers, puis fenêtre
	// pendant laquelle attendre la double acceptation. Si l'un n'accepte
	// pas dans la fenêtre, friend_skipped est envoyé à l'autre.
	friendPromptDelay  = 10 * time.Minute
	friendAcceptWindow = 60 * time.Second
)

type Deps struct {
	RDB      *redis.Client
	Matcher  *matcher.Matcher
	Hub      *Hub
	Quota    *quota.Engine
	Block    *moderation.Blocklist
	Reports  *reports.Service  // nil si Postgres / clé de chiffrement absents
	Bans     *bans.Service     // nil si Postgres absent
	Blocking *blocking.Service // block-list personnelle (auto-ajout sur report)
	// Auth user (optionnelle, pour résoudre le cookie au handshake et
	// remplir Session.UserID si valide). nil = WS toujours anonyme.
	UserAuth *UserAuth
	// Friends (optionnel). Si présent, le prompt ami 10-min est éligible
	// quand les deux peers sont authentifiés.
	Friends *friends.Store
	// Profiles (optionnel). Si présent et que le peer est authentifié,
	// on envoie un ServerPeerProfile au match (avatar + 3 prompts).
	Profiles *profile.Store
	Log      *slog.Logger
}

// UserAuth abstrait les bouts du package users dont le WS a besoin
// (verify cookie + cookie name). Évite l'import circulaire.
type UserAuth struct {
	CookieName    string
	SessionSecret []byte
	Verify        func(token string, secret []byte) (int64, error)
}

// Handler sert la route /ws/match. La validation des paramètres se fait
// AVANT l'upgrade WebSocket : un client invalide se voit refuser en 400
// JSON et n'établit jamais de socket — meilleure protection contre les
// connexions zombie côté Redis.
type Handler struct{ d Deps }

func NewHandler(d Deps) *Handler { return &Handler{d: d} }

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	params, err := parseParams(r)
	if err != nil {
		respondJSONError(w, http.StatusBadRequest, "invalid_param", err.Error())
		return
	}
	if err := moderation.ValidatePseudo(params.nick, h.d.Block); err != nil {
		respondJSONError(w, http.StatusBadRequest, "invalid_pseudo", err.Error())
		return
	}
	if err := matcher.ValidatePair(params.speaks, params.wants); err != nil {
		respondJSONError(w, http.StatusBadRequest, "invalid_param", err.Error())
		return
	}

	// Résout le cookie user AVANT l'upgrade — si présent et valide, la
	// session WS porte UserID > 0 et le flow ami devient éligible. Sinon
	// la WS reste anonyme.
	userID := h.resolveUserID(r)

	conn, err := Upgrade(w, r)
	if err != nil {
		h.d.Log.Warn("ws upgrade failed", "err", err)
		return
	}

	sess := session.New(
		params.nick,
		string(params.speaks),
		string(params.wants),
		params.fingerprint,
		hashIP(r),
		session.PlanFree,
	)
	sess.UserID = userID

	// Check ban actif AVANT registration / matching. Sur match, le client
	// reçoit une frame error code=banned avec la durée restante puis la WS
	// se ferme proprement.
	if h.d.Bans != nil {
		if b, err := h.d.Bans.CheckActive(r.Context(), sess.IPHash, sess.Fingerprint); err != nil {
			h.d.Log.Warn("ban check failed", "err", err)
		} else if b != nil {
			conn.WriteAndClose(ServerFrame{
				Type:    ServerError,
				Code:    ErrCodeBanned,
				Message: banMessage(b),
			})
			return
		}
	}

	wakeup := h.d.Hub.Register(sess)
	defer h.d.Hub.Unregister(sess.ID)

	go conn.Run(r.Context())
	h.runSession(r.Context(), conn, sess, wakeup)
}

// banMessage formate une raison utilisateur-visible (sans détails internes).
func banMessage(b *bans.Ban) string {
	if b.ExpiresAt == nil {
		if b.Reason != "" {
			return "Tu as été banni définitivement. Raison : " + b.Reason
		}
		return "Tu as été banni définitivement."
	}
	until := b.ExpiresAt.Format("2006-01-02 15:04 MST")
	if b.Reason != "" {
		return "Tu es suspendu jusqu'au " + until + ". Raison : " + b.Reason
	}
	return "Tu es suspendu jusqu'au " + until + "."
}

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
	friendEligible := h.d.Friends != nil && sess.UserID > 0 && peer.UserID > 0
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
					friendDone = tryMakeFriends(ctx, h, conn, sess.UserID, peer.UserID)
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
					friendDone = tryMakeFriends(ctx, h, conn, sess.UserID, peer.UserID)
				}
			}
		}
	}
}

// tryMakeFriends : appelé quand les deux côtés ont accepté le prompt 10-min.
// UPSERT idempotent — les deux peers le déclenchent en parallèle, peu
// importe l'ordre. On envoie ServerFriendMade au client local avec l'ID
// du friend pour qu'il puisse ouvrir le chat persisté.
// Renvoie true si tout s'est bien passé (sert au caller à set friendDone
// pour ne pas retenter).
func tryMakeFriends(ctx context.Context, h *Handler, conn *Conn, myUID, peerUID int64) bool {
	if h.d.Friends == nil {
		return false
	}
	f, err := h.d.Friends.Add(ctx, myUID, peerUID)
	if err != nil {
		h.d.Log.Error("friends add", "err", err)
		return false
	}
	conn.Send(ServerFrame{Type: ServerFriendMade, FriendID: f.ID})
	return true
}

// sendPeerProfile : récupère display_name / photo principale / prompts du
// peer authentifié et pousse une frame ServerPeerProfile au client local.
// Best-effort : silence sur erreur (chat anonyme reste fonctionnel).
func (h *Handler) sendPeerProfile(ctx context.Context, conn *Conn, peerUID int64) {
	fetchCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	p, err := h.d.Profiles.Get(fetchCtx, peerUID)
	if err != nil {
		return
	}
	photos, _ := h.d.Profiles.ListPhotos(fetchCtx, peerUID)
	photoID := ""
	for _, ph := range photos {
		if ph.Position == 1 {
			photoID = ph.PublicID
			break
		}
	}
	if photoID == "" && len(photos) > 0 {
		photoID = photos[0].PublicID
	}
	prompts := []ServerPrompt{
		{Prompt: p.Prompt1, Answer: p.Answer1},
		{Prompt: p.Prompt2, Answer: p.Answer2},
		{Prompt: p.Prompt3, Answer: p.Answer3},
	}
	conn.Send(ServerFrame{
		Type:        ServerPeerProfile,
		PeerPhotoID: photoID,
		PeerPrompts: prompts,
	})
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

// resolveUserID lit le cookie de session user du request et renvoie le
// UserID si valide. 0 si pas de cookie / auth désactivée / cookie invalide.
// Best-effort : un échec ne bloque pas l'upgrade — la WS reste anonyme.
func (h *Handler) resolveUserID(r *http.Request) int64 {
	if h.d.UserAuth == nil {
		return 0
	}
	c, err := r.Cookie(h.d.UserAuth.CookieName)
	if err != nil {
		return 0
	}
	uid, err := h.d.UserAuth.Verify(c.Value, h.d.UserAuth.SessionSecret)
	if err != nil {
		return 0
	}
	return uid
}

// hashIP hashe l'IP cliente avec SHA-256. Les logs ou la télémétrie ne
// doivent jamais voir l'IP brute (CLAUDE.md règle d'or #6).
func hashIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	sum := sha256.Sum256([]byte(host))
	return hex.EncodeToString(sum[:8])
}

func respondJSONError(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"code": code, "message": msg})
}

func mapModerationErr(err error) string {
	switch {
	case errors.Is(err, moderation.ErrMessageBlocked):
		return ErrCodeMessageBlocked
	case errors.Is(err, moderation.ErrMessageTooLong):
		return ErrCodeMessageTooLong
	default:
		return ErrCodeInvalidParam
	}
}
