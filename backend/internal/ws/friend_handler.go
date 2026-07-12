package ws

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/ralys/jolyne/backend/internal/friends"
	"github.com/ralys/jolyne/backend/internal/profile"
	"github.com/ralys/jolyne/backend/internal/push"
)

// FriendDeps regroupe les dépendances du handler WS friend.
// CLAUDE.md règle d'or #1 : les contenus passent ici car il s'agit
// d'utilisateurs mutuellement consentants après prompt 10-min — c'est
// l'unique dérogation acceptée. On ne LOG toujours pas les contenus.
type FriendDeps struct {
	RDB      *redis.Client
	Friends  *friends.Store
	UserAuth *UserAuth // obligatoire — pas de WS friend sans auth
	Push     *push.Sender
	Profile  *profile.Store // résout le nom à afficher dans la notif push
	Log      *slog.Logger
}

type FriendHandler struct{ d FriendDeps }

func NewFriendHandler(d FriendDeps) *FriendHandler { return &FriendHandler{d: d} }

// --- Wire protocol (séparé du match anonyme) ---

type friendClientType string

const (
	friendClientMsg friendClientType = "msg"
)

type friendServerType string

const (
	friendServerHistory     friendServerType = "history"
	friendServerMsg         friendServerType = "msg"
	friendServerPeerRemoved friendServerType = "peer_removed"
	friendServerRead        friendServerType = "read"
	friendServerTyping      friendServerType = "typing"
	friendServerStreak      friendServerType = "streak"
	friendServerError       friendServerType = "error"
)

type friendMsgDTO struct {
	ID       int64  `json:"id"`
	SenderID int64  `json:"sender_id"`
	Body     string `json:"body"`
	SentAt   string `json:"sent_at"`
	// Présents si le message a été modifié / supprimé. Si Deleted, Body
	// est vidé côté serveur — c'est le client qui affiche "Ce message a
	// été supprimé".
	EditedAt  string `json:"edited_at,omitempty"`
	DeletedAt string `json:"deleted_at,omitempty"`
	// Kind = "user" (omis JSON par défaut) ou un identifiant système. Le
	// front rend les `system_*` comme des lignes d'événement centrées.
	Kind string `json:"kind,omitempty"`
	// Payload : JSON brut (ex. {"days":12}) lié au kind système.
	Payload string `json:"payload,omitempty"`
}

// toDTO : convertit une `friends.Message` en payload WS. Les champs
// nullables (EditedAt, DeletedAt) deviennent des chaînes vides → JSON
// les omet (omitempty), ce qui laisse le client appliquer le défaut.
// Si le message est supprimé, on vide le Body côté serveur — pas la
// peine de le pousser au client.
func toDTO(m friends.Message) friendMsgDTO {
	dto := friendMsgDTO{
		ID:       m.ID,
		SenderID: m.SenderID,
		Body:     m.Body,
		SentAt:   m.SentAt.UTC().Format(time.RFC3339),
	}
	if m.EditedAt != nil {
		dto.EditedAt = m.EditedAt.UTC().Format(time.RFC3339)
	}
	if m.DeletedAt != nil {
		dto.DeletedAt = m.DeletedAt.UTC().Format(time.RFC3339)
		dto.Body = ""
	}
	if m.Kind != "" && m.Kind != friends.MessageKindUser {
		dto.Kind = m.Kind
		dto.Payload = m.Payload
	}
	return dto
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
	// Présents uniquement sur `streak` : nouvelle valeur courante et flag
	// at_risk. Le client met à jour le badge du header sans refetch HTTP.
	// Pointeurs pour distinguer "absent" (omis) de "valeur 0/false".
	Streak       *int  `json:"streak,omitempty"`
	StreakAtRisk *bool `json:"streak_at_risk,omitempty"`
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
	// `friendKindEdit` / `friendKindDelete` : timestamps relatifs.
	EditedAt  string `json:"e,omitempty"`
	DeletedAt string `json:"d,omitempty"`
	// `friendKindRead` uniquement : user_id ayant marqué + timestamp.
	// Un subscriber filtre les receipts qui le concernent (= ceux émis
	// par l'autre membre, pas les siens).
	ReadByUID int64  `json:"u,omitempty"`
	ReadAt    string `json:"r,omitempty"`
	// `friendKindStreak` uniquement : streak courant + flag at_risk.
	Streak       int  `json:"sk,omitempty"`
	StreakAtRisk bool `json:"ar,omitempty"`
	// Pour les messages système (kind = system_*) : type d'événement et
	// payload JSON brut. Vides pour un message utilisateur.
	MsgKind    string `json:"mk,omitempty"`
	MsgPayload string `json:"mp,omitempty"`
}

const (
	friendKindMsg     = "msg"
	friendKindRemoved = "removed"
	friendKindRead    = "read"   // peer a marqué la conv comme lue
	friendKindEdit    = "edit"   // un message a été modifié — payload = état complet
	friendKindDelete  = "delete" // un message a été supprimé (soft)
	friendKindTyping  = "typing" // peer est en train d'écrire
	friendKindStreak  = "streak" // streak courant mis à jour après un message
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
	go func() { //nolint:gosec // G118 : accusé de lecture asynchrone, hors chemin critique
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
		hist = append(hist, toDTO(m))
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
			case friendKindMsg, friendKindEdit, friendKindDelete:
				// Tous trois transportent l'état complet d'un message
				// (créé / modifié / supprimé) — le client dédup par ID
				// et remplace. Body est déjà vide côté envelope si le
				// message est supprimé.
				conn.Send(friendServerFrame{
					Type: friendServerMsg,
					Msg: &friendMsgDTO{
						ID:        env.ID,
						SenderID:  env.SenderID,
						Body:      env.Body,
						SentAt:    env.SentAt,
						EditedAt:  env.EditedAt,
						DeletedAt: env.DeletedAt,
						Kind:      env.MsgKind,
						Payload:   env.MsgPayload,
					},
				})

				// Si on reçoit un nouveau message du peer en direct et qu'on est connecté,
				// cela signifie qu'on a la conversation ouverte. On le marque automatiquement
				// comme lu en base et on notifie le peer via pub/sub pour le "Vu" en temps réel.
				if env.Kind == friendKindMsg && env.SenderID != uid {
					go func() { //nolint:gosec // G118 : accusé de lecture asynchrone, hors chemin critique
						readCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
						defer cancel()
						if err := h.d.Friends.MarkRead(readCtx, f.ID, uid); err == nil {
							h.publish(readCtx, chanName, friendEnvelope{
								Kind:      friendKindRead,
								FromConn:  connID,
								ReadByUID: uid,
								ReadAt:    time.Now().UTC().Format(time.RFC3339),
							})
						}
					}()
				}
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
			case friendKindTyping:
				// Si l'event d'écriture vient de nous-même (tab ouvert ailleurs), on l'ignore
				if env.SenderID == uid {
					continue
				}
				conn.Send(friendServerFrame{
					Type: friendServerTyping,
				})
			case friendKindStreak:
				st := env.Streak
				ar := env.StreakAtRisk
				conn.Send(friendServerFrame{
					Type:         friendServerStreak,
					Streak:       &st,
					StreakAtRisk: &ar,
				})
			}
		case raw, ok := <-conn.Inbound:
			if !ok {
				return
			}
			// Le ws.Conn décode toujours en `ClientFrame` (compat chat
			// anonyme). On dispatche sur `Type` pour les frames friend.
			switch ClientType(raw.Type) {
			case ClientType(friendClientMsg):
				h.handleSend(ctx, conn, connID, chanName, f.ID, uid, raw.Body)
			case ClientFriendEditMsg:
				h.handleEdit(ctx, conn, connID, chanName, uid, raw.ID, raw.Body)
			case ClientFriendDeleteMsg:
				h.handleDelete(ctx, conn, connID, chanName, uid, raw.ID)
			case ClientTyping:
				h.handleTyping(ctx, connID, chanName, uid)
			}
		}
	}
}

// handleSend : persiste un nouveau message, fait l'echo au sender et le
// publie au peer. Aucune validation côté friendship n'est rejouée par
// AppendMessage (les checks d'éligibilité ont été faits à l'ouverture
// du WS).
func (h *FriendHandler) handleSend(
	ctx context.Context, conn *Conn, connID, chanName string,
	friendID, uid int64, rawBody string,
) {
	body := strings.TrimSpace(rawBody)
	if body == "" {
		return
	}
	persistCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if _, err := h.d.Friends.Get(persistCtx, friendID, uid); err != nil {
		return
	}
	m, streak, err := h.d.Friends.AppendMessageWithStreak(persistCtx, friendID, uid, body)
	if err != nil {
		conn.Send(friendErr("invalid_body", "message refused"))
		return
	}
	dto := toDTO(m)
	conn.Send(friendServerFrame{Type: friendServerMsg, Msg: &dto})
	h.publish(ctx, chanName, friendEnvelope{
		Kind: friendKindMsg, FromConn: connID,
		ID: m.ID, SenderID: m.SenderID, Body: dto.Body, SentAt: dto.SentAt,
	})

	// Streak live : pousse la nouvelle valeur courante au sender (echo
	// local) ET au peer via le channel friend → le badge du header se
	// met à jour des deux côtés sans attendre un refetch. On notifie
	// aussi les deux inbox channels pour rafraîchir la liste d'amis.
	peerUID := friendPeerUID(uid, friendID, h)
	{
		st := streak.Current
		ar := streak.AtRisk
		conn.Send(friendServerFrame{
			Type:         friendServerStreak,
			Streak:       &st,
			StreakAtRisk: &ar,
		})
		h.publish(ctx, chanName, friendEnvelope{
			Kind: friendKindStreak, FromConn: connID,
			Streak: streak.Current, StreakAtRisk: streak.AtRisk,
		})
		go func() { //nolint:gosec // G118 : écriture asynchrone assumée, hors chemin critique
			bgCtx, bgCancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer bgCancel()
			ids := []int64{uid}
			if peerUID > 0 {
				ids = append(ids, peerUID)
			}
			friends.PublishStreakUpdate(bgCtx, h.d.RDB, ids, friendID, streak.Current, streak.AtRisk)
		}()
	}

	// Web Push best-effort vers le peer. Goroutine détachée — on ne ralentit
	// jamais le hot-path de la conv. Body tronqué (preview) : le contenu
	// brut n'est pas envoyé. Pas de log du body côté push (CLAUDE.md règle
	// d'or #1).
	if h.d.Push != nil && peerUID > 0 {
		go func() { //nolint:gosec // G118 : notification fire-and-forget, survit à la requête (voulu)
			bgCtx, bgCancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer bgCancel()
			preview := body
			if len(preview) > 80 {
				preview = preview[:80]
			}
			name := ""
			if h.d.Profile != nil {
				if p, err := h.d.Profile.Get(bgCtx, uid); err == nil {
					name = p.DisplayName
				}
			}
			if name == "" {
				name = "Nouveau message"
			}
			h.d.Push.SendToUser(bgCtx, peerUID, push.Payload{
				Title:    name,
				Body:     preview,
				URL:      "/chats/" + strconv.FormatInt(friendID, 10),
				FriendID: friendID,
				Tag:      "friend-" + strconv.FormatInt(friendID, 10),
			})
		}()
	}

	// Milestone : palier franchi dans cette transaction. On notifie les
	// deux users (sender ET peer) via leur inbox channel respectif, et on
	// envoie un push web spécial avec un titre "🔥 N jours". Détaché.
	if streak.NewMilestone > 0 {
		go func() { //nolint:gosec // G118 : push fire-and-forget, survit à la requête (voulu)
			bgCtx, bgCancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer bgCancel()
			publishMilestone(bgCtx, h.d.RDB, friendID, uid, streak.NewMilestone)
			if peerUID > 0 {
				publishMilestone(bgCtx, h.d.RDB, friendID, peerUID, streak.NewMilestone)
				if h.d.Push != nil {
					h.d.Push.SendToUser(bgCtx, peerUID, push.Payload{
						Title:    "🔥 " + strconv.Itoa(streak.NewMilestone) + " jours d'affilée !",
						Body:     "Continuez sur votre lancée.",
						URL:      "/chats/" + strconv.FormatInt(friendID, 10),
						FriendID: friendID,
						Tag:      "milestone-" + strconv.FormatInt(friendID, 10),
					})
					h.d.Push.SendToUser(bgCtx, uid, push.Payload{
						Title:    "🔥 " + strconv.Itoa(streak.NewMilestone) + " jours d'affilée !",
						Body:     "Continuez sur votre lancée.",
						URL:      "/chats/" + strconv.FormatInt(friendID, 10),
						FriendID: friendID,
						Tag:      "milestone-" + strconv.FormatInt(friendID, 10),
					})
				}
			}
		}()
	}
}

// publishMilestone : pousse un event "streak_milestone" dans l'inbox d'un
// user. Le payload est volontairement plat (texte simple) pour rester
// compatible avec le format du channel meta.
func publishMilestone(ctx context.Context, rdb *redis.Client, friendID, userID int64, n int) {
	if rdb == nil {
		return
	}
	// Format : "milestone:{friend_id}:{n}" — l'inbox handler parse.
	payload := "milestone:" + strconv.FormatInt(friendID, 10) + ":" + strconv.Itoa(n)
	_ = rdb.Publish(ctx, friends.UserInboxChannel(userID), payload).Err()
}

// friendPeerUID : récupère l'ID du peer d'une amitié (peer = l'autre user
// que celui qui envoie). Helper local — on lit le Friend via Store.Get.
func friendPeerUID(senderUID, friendID int64, h *FriendHandler) int64 {
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()
	f, err := h.d.Friends.Get(ctx, friendID, senderUID)
	if err != nil {
		return 0
	}
	return f.PeerID
}

// handleEdit : modifie un message existant (auteur uniquement, dans la
// fenêtre `friends.EditWindow`). Echo + publish portent l'état complet.
func (h *FriendHandler) handleEdit(
	ctx context.Context, conn *Conn, connID, chanName string,
	uid int64, rawID, rawBody string,
) {
	msgID, err := strconv.ParseInt(rawID, 10, 64)
	if err != nil || msgID <= 0 {
		conn.Send(friendErr("invalid_param", "id required"))
		return
	}
	editCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	m, err := h.d.Friends.EditMessage(editCtx, msgID, uid, rawBody)
	if err != nil {
		if errors.Is(err, friends.ErrEditWindowClosed) {
			conn.Send(friendErr("edit_window_closed", "edit window closed"))
		} else {
			conn.Send(friendErr("invalid_body", "edit refused"))
		}
		return
	}
	dto := toDTO(m)
	conn.Send(friendServerFrame{Type: friendServerMsg, Msg: &dto})
	h.publish(ctx, chanName, friendEnvelope{
		Kind: friendKindEdit, FromConn: connID,
		ID: m.ID, SenderID: m.SenderID, Body: dto.Body, SentAt: dto.SentAt,
		EditedAt: dto.EditedAt,
	})
}

// handleDelete : soft-delete un message (auteur uniquement). Echo +
// publish — le client remplace le rendu par "Ce message a été supprimé".
func (h *FriendHandler) handleDelete(
	ctx context.Context, conn *Conn, connID, chanName string,
	uid int64, rawID string,
) {
	msgID, err := strconv.ParseInt(rawID, 10, 64)
	if err != nil || msgID <= 0 {
		conn.Send(friendErr("invalid_param", "id required"))
		return
	}
	delCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	m, err := h.d.Friends.DeleteMessage(delCtx, msgID, uid)
	if err != nil {
		conn.Send(friendErr("not_found", "message not found"))
		return
	}
	dto := toDTO(m)
	conn.Send(friendServerFrame{Type: friendServerMsg, Msg: &dto})
	h.publish(ctx, chanName, friendEnvelope{
		Kind: friendKindDelete, FromConn: connID,
		ID: m.ID, SenderID: m.SenderID, SentAt: dto.SentAt,
		EditedAt: dto.EditedAt, DeletedAt: dto.DeletedAt,
	})
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
	return h.d.UserAuth.Resolve(r.Context(), r)
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

func (h *FriendHandler) handleTyping(ctx context.Context, connID, chanName string, uid int64) {
	h.publish(ctx, chanName, friendEnvelope{
		Kind:     friendKindTyping,
		FromConn: connID,
		SenderID: uid,
	})
}

func friendErr(code, msg string) friendServerFrame {
	return friendServerFrame{Type: friendServerError, Code: code, Message: msg}
}

// PublishFriendSystemMessage retourne un publisher utilisable par les jobs
// externes (cron streak-loss notamment) pour pousser un message système
// inséré en DB vers les peers actuellement connectés. Sans Redis (`rdb`
// nil) → no-op : la persistance suffit, le frontend récupérera la ligne
// à l'ouverture suivante de la conv.
func PublishFriendSystemMessage(rdb *redis.Client) friends.StreakLossPublisher {
	if rdb == nil {
		return nil
	}
	return func(ctx context.Context, friendID, msgID, senderID int64, body, kind, payload, sentAt string) {
		env := friendEnvelope{
			Kind:       friendKindMsg,
			FromConn:   "cron",
			ID:         msgID,
			SenderID:   senderID,
			Body:       body,
			SentAt:     sentAt,
			MsgKind:    kind,
			MsgPayload: payload,
		}
		raw, err := json.Marshal(env)
		if err != nil {
			return
		}
		_ = rdb.Publish(ctx, friendChannel(friendID), raw).Err()
	}
}

// PublishFriendStreak retourne un publisher qui pousse un frame `streak` sur
// le channel d'une amitié — utilisé par le handler de restauration pour
// rallumer la flamme dans le header de conversation des deux amis connectés,
// par le même chemin que les bumps de streak après un message.
func PublishFriendStreak(rdb *redis.Client) friends.StreakFramePublisher {
	if rdb == nil {
		return nil
	}
	return func(ctx context.Context, friendID int64, streak int, atRisk bool) {
		env := friendEnvelope{
			Kind:         friendKindStreak,
			FromConn:     "restore",
			Streak:       streak,
			StreakAtRisk: atRisk,
		}
		raw, err := json.Marshal(env)
		if err != nil {
			return
		}
		_ = rdb.Publish(ctx, friendChannel(friendID), raw).Err()
	}
}
