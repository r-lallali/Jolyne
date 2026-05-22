package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/friends"
)

// FriendDeps regroupe les dépendances du handler WS friend.
// CLAUDE.md règle d'or #1 : les contenus passent ici car il s'agit
// d'utilisateurs mutuellement consentants après prompt 10-min — c'est
// l'unique dérogation acceptée. On ne LOG toujours pas les contenus.
type FriendDeps struct {
	RDB      *redis.Client
	Friends  *friends.Store
	UserAuth *UserAuth // obligatoire — pas de WS friend sans auth
	Log      *slog.Logger
}

type FriendHandler struct{ d FriendDeps }

func NewFriendHandler(d FriendDeps) *FriendHandler { return &FriendHandler{d: d} }

// --- Wire protocol (séparé du match anonyme) ---

type friendClientType string

const (
	friendClientMsg friendClientType = "msg"
)

type friendClientFrame struct {
	Type friendClientType `json:"type"`
	Body string           `json:"body,omitempty"`
}

type friendServerType string

const (
	friendServerHistory     friendServerType = "history"
	friendServerMsg         friendServerType = "msg"
	friendServerPeerRemoved friendServerType = "peer_removed"
	friendServerRead        friendServerType = "read"
	friendServerError       friendServerType = "error"
)

type friendMsgDTO struct {
	ID       int64  `json:"id"`
	SenderID int64  `json:"sender_id"`
	Body     string `json:"body"`
	SentAt   string `json:"sent_at"`
}

type friendServerFrame struct {
	Type    friendServerType `json:"type"`
	Code    string           `json:"code,omitempty"`
	Message string           `json:"message,omitempty"`
	// Pas d'omitempty : `[]` doit être sérialisé même quand l'historique
	// est vide, sinon le front reçoit `messages: undefined` au lieu de
	// `[]` et le `useEffect` deps `[msgs.length]` crash sur un nouveau
	// chat sans message.
	Messages []friendMsgDTO `json:"messages"`
	Msg      *friendMsgDTO  `json:"msg,omitempty"`
	// Timestamp du dernier message lu PAR LE PEER (RFC3339, vide si jamais).
	// Présent sur `history` (état initial) et sur `read` (push live quand
	// le peer ouvre la conv). Permet d'afficher le marqueur "Vu" sous
	// mes propres messages dont sent_at <= ReadAt.
	ReadAt string `json:"read_at,omitempty"`
}

const friendChanPrefix = "friend:"

// friendEnvelope est le payload pub/sub. FromConn permet à un subscriber
// de filtrer son propre echo (au cas où la même conn écoute et publie).
type friendEnvelope struct {
	Kind     string `json:"k"`
	FromConn string `json:"f"`
	ID       int64  `json:"i,omitempty"`
	SenderID int64  `json:"s,omitempty"`
	Body     string `json:"b,omitempty"`
	SentAt   string `json:"t,omitempty"`
	// `friendKindRead` uniquement : user_id ayant marqué + timestamp.
	// Un subscriber filtre les receipts qui le concernent (= ceux émis
	// par l'autre membre, pas les siens).
	ReadByUID int64  `json:"u,omitempty"`
	ReadAt    string `json:"r,omitempty"`
}

const (
	friendKindMsg     = "msg"
	friendKindRemoved = "removed"
	friendKindRead    = "read" // peer a marqué la conv comme lue
)

func friendChannel(friendID int64) string {
	return friendChanPrefix + strconv.FormatInt(friendID, 10)
}

// ServeHTTP : GET /ws/friend/{id}. Cookie session user requis, membre
// du friendship requis, et friend non-soft-deleted côté caller.
func (h *FriendHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.d.UserAuth == nil {
		http.Error(w, "auth disabled", http.StatusServiceUnavailable)
		return
	}
	uid := h.resolveUser(r)
	if uid == 0 {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}
	friendID, err := parseFriendIDFromPath(r.URL.Path)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	// Vérifie l'appartenance + pas soft-deleted côté caller.
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	f, err := h.d.Friends.Get(ctx, friendID, uid)
	cancel()
	if err != nil {
		http.NotFound(w, r)
		return
	}

	conn, err := Upgrade(w, r)
	if err != nil {
		return
	}
	go conn.Run(r.Context())
	h.runFriend(r.Context(), conn, uid, f)
}

func (h *FriendHandler) runFriend(ctx context.Context, conn *Conn, uid int64, f friends.Friend) {
	connID := uuid.NewString()
	chanName := friendChannel(f.ID)

	ps := h.d.RDB.Subscribe(ctx, chanName)
	if _, err := ps.Receive(ctx); err != nil {
		conn.WriteAndClose(friendErr("internal", "subscribe failed"))
		return
	}
	defer func() { _ = ps.Close() }()

	// Récupère le timestamp de lecture courant du peer pour l'envoyer
	// dans l'history → permet d'afficher "Vu" immédiatement sur les
	// messages déjà lus à l'ouverture.
	peerReadCtx, peerReadCancel := context.WithTimeout(ctx, 2*time.Second)
	peerRead, _ := h.d.Friends.PeerLastReadAt(peerReadCtx, f.ID, uid)
	peerReadCancel()
	peerReadISO := ""
	if peerRead != nil {
		peerReadISO = peerRead.UTC().Format(time.RFC3339)
	}

	// Auto mark-as-read : ouvrir la conv = avoir tout lu. Publie aussi un
	// receipt pub/sub pour que l'autre côté (s'il est connecté) bascule
	// son indicateur "Vu" en temps réel. Best-effort des deux côtés.
	go func() {
		readCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := h.d.Friends.MarkRead(readCtx, f.ID, uid); err != nil {
			if h.d.Log != nil {
				h.d.Log.Warn("friend mark read failed", "err", err)
			}
			return
		}
		h.publish(readCtx, chanName, friendEnvelope{
			Kind:      friendKindRead,
			FromConn:  connID,
			ReadByUID: uid,
			ReadAt:    time.Now().UTC().Format(time.RFC3339),
		})
	}()

	// Envoie l'historique (200 derniers).
	histCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	msgs, err := h.d.Friends.ListMessages(histCtx, f.ID, 0)
	cancel()
	if err != nil {
		conn.WriteAndClose(friendErr("internal", "history failed"))
		return
	}
	hist := make([]friendMsgDTO, 0, len(msgs))
	for _, m := range msgs {
		hist = append(hist, friendMsgDTO{
			ID: m.ID, SenderID: m.SenderID, Body: m.Body,
			SentAt: m.SentAt.UTC().Format(time.RFC3339),
		})
	}
	conn.Send(friendServerFrame{
		Type:     friendServerHistory,
		Messages: hist,
		ReadAt:   peerReadISO,
	})

	// Si le peer m'a déjà retiré à l'ouverture, on informe — le front
	// affiche le card supprimé. La connexion reste ouverte (le user
	// peut consulter l'historique).
	if f.PeerRemovedMe {
		conn.Send(friendServerFrame{Type: friendServerPeerRemoved})
	}

	// Canal pub/sub déjà décodé + filtré (skip own connID).
	peerCh := make(chan friendEnvelope, outboundBuffer)
	go func() {
		defer close(peerCh)
		for raw := range ps.Channel() {
			var env friendEnvelope
			if err := json.Unmarshal([]byte(raw.Payload), &env); err != nil {
				continue
			}
			if env.FromConn == connID {
				continue
			}
			peerCh <- env
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case <-conn.Done():
			return
		case env, ok := <-peerCh:
			if !ok {
				return
			}
			switch env.Kind {
			case friendKindMsg:
				conn.Send(friendServerFrame{
					Type: friendServerMsg,
					Msg: &friendMsgDTO{
						ID: env.ID, SenderID: env.SenderID,
						Body: env.Body, SentAt: env.SentAt,
					},
				})
			case friendKindRemoved:
				conn.Send(friendServerFrame{Type: friendServerPeerRemoved})
			case friendKindRead:
				// On ne relaie un read receipt que s'il vient du peer
				// (pas de notre propre tab ouvert ailleurs).
				if env.ReadByUID == uid {
					continue
				}
				conn.Send(friendServerFrame{
					Type:   friendServerRead,
					ReadAt: env.ReadAt,
				})
			}
		case raw, ok := <-conn.Inbound:
			if !ok {
				return
			}
			// On reparse l'inbound brut comme un friendClientFrame —
			// le ws.Conn décode déjà en ClientFrame (match), mais les
			// champs `type`/`body` se chevauchent et c'est suffisant
			// pour notre cas (msg uniquement).
			ft := friendClientType(string(raw.Type))
			if ft != friendClientMsg {
				continue
			}
			body := strings.TrimSpace(raw.Body)
			if body == "" {
				continue
			}
			// Vérifie l'état d'amitié AVANT persistance — si j'ai retiré
			// entre temps, on ferme. Si le peer m'a retiré, on persiste
			// quand même (les deux gardent l'historique).
			persistCtx, persistCancel := context.WithTimeout(ctx, 3*time.Second)
			cur, errGet := h.d.Friends.Get(persistCtx, f.ID, uid)
			if errGet != nil {
				persistCancel()
				return
			}
			m, errAppend := h.d.Friends.AppendMessage(persistCtx, f.ID, uid, body)
			persistCancel()
			if errAppend != nil {
				conn.Send(friendErr("invalid_body", "message refused"))
				continue
			}
			dto := friendMsgDTO{
				ID: m.ID, SenderID: m.SenderID, Body: m.Body,
				SentAt: m.SentAt.UTC().Format(time.RFC3339),
			}
			// Echo direct au sender (pas de roundtrip pub/sub).
			conn.Send(friendServerFrame{Type: friendServerMsg, Msg: &dto})
			// Publie pour le peer (sa conn skip via FromConn filter).
			h.publish(ctx, chanName, friendEnvelope{
				Kind: friendKindMsg, FromConn: connID,
				ID: m.ID, SenderID: m.SenderID, Body: m.Body, SentAt: dto.SentAt,
			})
			_ = cur
		}
	}
}

func (h *FriendHandler) publish(ctx context.Context, chanName string, env friendEnvelope) {
	payload, err := json.Marshal(env)
	if err != nil {
		return
	}
	if err := h.d.RDB.Publish(ctx, chanName, payload).Err(); err != nil {
		if h.d.Log != nil {
			h.d.Log.Warn("friend publish failed", "err", err)
		}
	}
}

func (h *FriendHandler) resolveUser(r *http.Request) int64 {
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

func parseFriendIDFromPath(path string) (int64, error) {
	rest := strings.TrimPrefix(path, "/ws/friend/")
	if rest == "" || rest == path {
		return 0, fmt.Errorf("no id")
	}
	if i := strings.Index(rest, "/"); i >= 0 {
		rest = rest[:i]
	}
	return strconv.ParseInt(rest, 10, 64)
}

func friendErr(code, msg string) friendServerFrame {
	return friendServerFrame{Type: friendServerError, Code: code, Message: msg}
}
