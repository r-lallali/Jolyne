package ws

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/matcher"
	"github.com/ralys/jolyne/backend/internal/moderation"
	"github.com/ralys/jolyne/backend/internal/quota"
	"github.com/ralys/jolyne/backend/internal/session"
)

const queueTimeout = 30 * time.Second

type Deps struct {
	RDB     *redis.Client
	Matcher *matcher.Matcher
	Hub     *Hub
	Quota   *quota.Engine
	Block   *moderation.Blocklist
	Log     *slog.Logger
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

	wakeup := h.d.Hub.Register(sess)
	defer h.d.Hub.Unregister(sess.ID)

	go conn.Run(r.Context())
	h.runSession(r.Context(), conn, sess, wakeup)
}

// runSession est la boucle d'états : (try match → in-chat → next) en tournant.
// Toute sortie passe par les defers en amont.
func (h *Handler) runSession(ctx context.Context, conn *Conn, sess session.Session, wakeup <-chan WakeupEvent) {
	speaks, wants := matcher.LangCode(sess.Speaks), matcher.LangCode(sess.Wants)

	for {
		out, err := h.d.Matcher.TryMatch(ctx, speaks, wants, sess.ID)
		if err != nil {
			h.d.Log.Error("matcher error", "err", err)
			conn.Send(ServerFrame{Type: ServerError, Code: ErrCodeInternal})
			return
		}

		var roomID, peerNick string
		switch {
		case out.Matched:
			roomID = uuid.NewString()
			peer, ok := h.d.Hub.Lookup(out.PeerID)
			if !ok {
				// Peer disparu entre LPOP et Lookup — on re-tente.
				continue
			}
			peerNick = peer.Pseudo
			if !h.d.Hub.Wakeup(out.PeerID, WakeupEvent{RoomID: roomID, PeerNick: sess.Pseudo}) {
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

		exit := h.runChat(ctx, conn, sess, roomID, peerNick)
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

// runChat est la boucle de chat avec un peer. Sort proprement sur "next",
// peer_left ou déconnexion. La room Redis est ouverte ici, fermée au retour.
//
// Aucun contenu de message n'est loggé — règle d'or #1.
func (h *Handler) runChat(ctx context.Context, conn *Conn, sess session.Session, roomID, peerNick string) chatExit {
	room, err := openRoom(ctx, h.d.RDB, roomID, sess.ID)
	if err != nil {
		h.d.Log.Error("room open", "err", err)
		conn.Send(ServerFrame{Type: ServerError, Code: ErrCodeInternal})
		return chatDisconnect
	}
	defer room.Close()
	conn.Send(ServerFrame{Type: ServerMatched, Room: roomID, PeerNick: peerNick})

	peer := room.Channel()
	for {
		select {
		case <-ctx.Done():
			return chatDisconnect
		case <-conn.Done():
			return chatDisconnect
		case env, ok := <-peer:
			if !ok {
				return chatDisconnect
			}
			switch env.Kind {
			case roomKindMsg:
				conn.Send(ServerFrame{Type: ServerMsg, Body: env.Body})
			case roomKindLeft:
				conn.Send(ServerFrame{Type: ServerPeerLeft})
				return chatPeerLeft
			}
		case msg, ok := <-conn.Inbound:
			if !ok {
				return chatDisconnect
			}
			switch msg.Type {
			case ClientMsg:
				safe, err := moderation.SanitizeAndCheck(msg.Body, h.d.Block)
				if err != nil {
					conn.Send(ServerFrame{Type: ServerError, Code: mapModerationErr(err)})
					continue
				}
				if err := room.SendMsg(ctx, safe); err != nil {
					h.d.Log.Error("room publish", "err", err)
					return chatDisconnect
				}
			case ClientNext:
				_ = room.SendLeft(ctx)
				return chatNext
			}
		}
	}
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
