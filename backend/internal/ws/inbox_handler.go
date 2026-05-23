package ws

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/friends"
)

// InboxHandler : WS global par user qui agrège les events de TOUTES ses
// conversations friend. Permet au front d'afficher des notifications live
// + de maintenir le compteur d'unread sans polling. Ne pousse jamais le
// contenu d'un message — uniquement metadata (sender_id, sent_at, preview
// tronqué côté serveur). Conformité RGPD : on ne logge rien des bodies.
type InboxDeps struct {
	RDB      *redis.Client
	Friends  *friends.Store
	UserAuth *UserAuth
	Log      *slog.Logger
}

type InboxHandler struct{ d InboxDeps }

func NewInboxHandler(d InboxDeps) *InboxHandler { return &InboxHandler{d: d} }

// Frames émises au client. Format simple — le client garde sa propre map
// `unreadByFriend` qu'il incrémente sur `msg` et reset sur `read`.
type inboxFrame struct {
	Type     string `json:"type"`
	FriendID int64  `json:"friend_id"`
	SenderID int64  `json:"sender_id,omitempty"`
	Preview  string `json:"preview,omitempty"`
	SentAt   string `json:"sent_at,omitempty"`
	// Champ rempli uniquement pour Type = "streak_milestone".
	Streak int `json:"streak,omitempty"`
}

const (
	inboxTypeMsg              = "msg"
	inboxTypeRead             = "read"
	inboxTypeRemoved          = "removed"
	inboxTypeFriendsChanged   = "friends_changed"
	inboxTypeStreakMilestone  = "streak_milestone"
)

// previewLen : on tronque le body pour la notification toast. Volontairement
// court — l'inbox n'est pas le client de lecture, juste une teasing line.
const previewLen = 80

func (h *InboxHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.d.UserAuth == nil {
		http.Error(w, "auth disabled", http.StatusServiceUnavailable)
		return
	}
	uid := h.resolveUser(r)
	if uid == 0 {
		http.Error(w, "auth required", http.StatusUnauthorized)
		return
	}

	// Liste des conversations actives du user, snapshotée à la connexion.
	// Les amis ajoutés/retirés pendant la session demandent un reconnect
	// côté client — c'est rare et acceptable pour un MVP inbox.
	listCtx, listCancel := context.WithTimeout(r.Context(), 3*time.Second)
	frs, err := h.d.Friends.ListFor(listCtx, uid)
	listCancel()
	if err != nil {
		http.Error(w, "internal", http.StatusInternalServerError)
		return
	}

	conn, err := Upgrade(w, r)
	if err != nil {
		return
	}
	go conn.Run(r.Context())

	// Channel meta du user — reçoit les events friends_changed (ajout /
	// retrait d'ami) pour signaler au front qu'il faut reconnecter le WS
	// (et donc re-snapshot la liste de friend channels côté backend).
	userMetaChan := friends.UserInboxChannel(uid)
	channels := make([]string, 0, len(frs)+1)
	channels = append(channels, userMetaChan)
	for _, f := range frs {
		channels = append(channels, friendChannel(f.ID))
	}

	ps := h.d.RDB.Subscribe(r.Context(), channels...)
	if _, err := ps.Receive(r.Context()); err != nil {
		conn.WriteAndClose(inboxErr("internal", "subscribe failed"))
		return
	}
	defer func() { _ = ps.Close() }()

	// Channel ID → bool : flag rapide pour identifier nos channels.
	// Sert essentiellement à parser l'ID depuis le nom de channel.
	chanCtx, chanCancel := context.WithCancel(r.Context())
	defer chanCancel()

	psCh := ps.Channel()
	var once sync.Once
	for {
		select {
		case <-chanCtx.Done():
			return
		case <-conn.Done():
			return
		case raw, ok := <-psCh:
			if !ok {
				once.Do(func() { chanCancel() })
				return
			}
			// Meta channel : payloads texte. Deux formats reconnus :
			//   - "friends_changed"             → reconnect côté client
			//   - "milestone:{friend_id}:{n}"   → notif palier streak
			if raw.Channel == userMetaChan {
				if raw.Payload == friends.UserInboxKindFriendsChanged {
					conn.Send(inboxFrame{Type: inboxTypeFriendsChanged})
					continue
				}
				if strings.HasPrefix(raw.Payload, "milestone:") {
					parts := strings.SplitN(raw.Payload, ":", 3)
					if len(parts) == 3 {
						fid, _ := strconv.ParseInt(parts[1], 10, 64)
						n, _ := strconv.Atoi(parts[2])
						if fid > 0 && n > 0 {
							conn.Send(inboxFrame{
								Type:     inboxTypeStreakMilestone,
								FriendID: fid,
								Streak:   n,
							})
						}
					}
				}
				continue
			}
			var env friendEnvelope
			if err := json.Unmarshal([]byte(raw.Payload), &env); err != nil {
				continue
			}
			friendID, ok := parseFriendChannel(raw.Channel)
			if !ok {
				continue
			}
			switch env.Kind {
			case friendKindMsg:
				// On ignore les messages que LE USER ENVOIE depuis un autre
				// onglet — sinon il se notifie lui-même.
				if env.SenderID == uid {
					continue
				}
				preview := env.Body
				if len(preview) > previewLen {
					preview = preview[:previewLen]
				}
				conn.Send(inboxFrame{
					Type:     inboxTypeMsg,
					FriendID: friendID,
					SenderID: env.SenderID,
					Preview:  preview,
					SentAt:   env.SentAt,
				})
			case friendKindRead:
				// Read receipt émis par NOUS (probablement parce qu'on
				// vient d'ouvrir la conv dans un autre onglet) → reset
				// l'unread côté client pour cette conv.
				if env.ReadByUID != uid {
					continue
				}
				conn.Send(inboxFrame{
					Type:     inboxTypeRead,
					FriendID: friendID,
				})
			case friendKindRemoved:
				conn.Send(inboxFrame{
					Type:     inboxTypeRemoved,
					FriendID: friendID,
				})
			}
		}
	}
}

func (h *InboxHandler) resolveUser(r *http.Request) int64 {
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

func parseFriendChannel(name string) (int64, bool) {
	if len(name) <= len(friendChanPrefix) {
		return 0, false
	}
	id, err := strconv.ParseInt(name[len(friendChanPrefix):], 10, 64)
	if err != nil {
		return 0, false
	}
	return id, true
}

func inboxErr(code, msg string) inboxFrame {
	return inboxFrame{Type: "error", Preview: code + ": " + msg}
}
