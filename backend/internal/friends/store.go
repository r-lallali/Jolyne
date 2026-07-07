// Package friends : amitiés bidirectionnelles + chat persisté entre amis.
// Voir CLAUDE.md règle d'or #1 (dérogation Phase 3 — uniquement entre
// utilisateurs qui se sont mutuellement ajoutés à la fin d'une session
// anonyme de ≥ 10 min).
package friends

import (
	"context"
	"errors"
	"fmt"
	"html"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound = errors.New("friends: not found")
)

const MessageMaxLen = 2000

type Friend struct {
	ID            int64
	UserAID       int64
	UserBID       int64
	CreatedAt     time.Time
	LastMessageAt time.Time
	// PeerID + PeerRemovedMe sont remplis par ListFor() pour faciliter
	// l'affichage côté caller (le caller passe son propre user_id, on lui
	// renvoie l'ID du peer + si le peer t'a déjà retiré).
	PeerID        int64
	PeerRemovedMe bool
	// PeerLang : langue native du peer figée à la création de l'amitié
	// ("" si inconnue — flux pending). Indice de langue source pour le
	// tap-to-translate côté front.
	PeerLang string
	// UnreadCount : nb de messages du peer postérieurs au last_read_at du
	// caller. Rempli par ListFor(). 0 si toutes les conversations sont
	// rattrapées.
	UnreadCount int
	// Aperçu du dernier message envoyé dans la conv (vide si aucune
	// activité encore). Sert au rendu type messagerie Instagram dans la
	// sidebar des conversations. LastMessageDeleted = true quand le
	// dernier message a été soft-deleted (le body remonté est alors "").
	LastMessageBody     string
	LastMessageSenderID int64
	LastMessageDeleted  bool
	// Streak entre les 2 amis (style TikTok). Streak = 0 si expiré (le
	// dernier jour validé bilatéral remonte à > 1j). AtRisk = on a un
	// jour pour ne pas le perdre, mais au moins un des deux n'a pas
	// encore écrit aujourd'hui. LostStreak / LostAt : valeur du streak
	// récemment perdu, disponible pour restauration (≤ 7 jours).
	Streak     int
	StreakAtRisk bool
	LostStreak int
	LostAt     *time.Time
}

// EditWindow : durée pendant laquelle l'auteur d'un message peut le
// modifier après l'envoi. Au-delà, l'édition est rejetée serveur (le
// front cache aussi le bouton, mais la source de vérité reste ici).
const EditWindow = 5 * time.Minute

type Message struct {
	ID       int64
	FriendID int64
	SenderID int64
	Body     string
	SentAt   time.Time
	// EditedAt / DeletedAt : nil = état initial. Le store remplit ces
	// pointeurs depuis la DB. La suppression est soft — la ligne reste
	// pour préserver l'ordre, mais Body est vidé côté DTO.
	EditedAt  *time.Time
	DeletedAt *time.Time
	// Kind = "user" pour un message classique (par défaut), ou un
	// identifiant d'événement système — voir kind_*.go. Les messages
	// système ne sont pas éditables ni supprimables côté UI.
	Kind string
	// Payload : JSON brut pour les messages système (ex. {"days":12}).
	// Vide pour les messages utilisateur.
	Payload string
}

const (
	// MessageKindUser : message tapé par un user. Valeur par défaut en DB.
	MessageKindUser = "user"
	// MessageKindStreakLost : ligne système posée par le cron quand un
	// streak ≥ 2 s'est terminé. Payload = {"days": <perdu>}.
	MessageKindStreakLost = "system_streak_lost"
	// MessageKindStreakRestored : ligne système posée quand un ami restaure
	// un streak perdu. Payload = {"days": <restauré>}.
	MessageKindStreakRestored = "system_streak_restored"
)

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// Add : crée le lien d'amitié (ou no-op si déjà existant). Renvoie le
// Friend avec son ID. Les user IDs sont ordonnés en interne pour respecter
// la contrainte user_a < user_b. lang1/lang2 = langues natives respectives
// de u1/u2 ("" si inconnues — flux pending) ; sur un re-add on ne remplit
// que les colonnes encore NULL (COALESCE) pour ne pas écraser l'existant.
func (s *Store) Add(ctx context.Context, u1, u2 int64, lang1, lang2 string) (Friend, error) {
	if u1 == u2 {
		return Friend{}, fmt.Errorf("friends: same user")
	}
	// Défense en profondeur : un peer anonyme (UserID = 0) ne doit JAMAIS
	// se retrouver dans la table friends — la FK vers users échouerait,
	// mais on bail avant pour éviter d'écrire un état orphelin.
	if u1 <= 0 || u2 <= 0 {
		return Friend{}, fmt.Errorf("friends: peer anonyme non éligible")
	}
	a, b := ordered(u1, u2)
	langA, langB := lang1, lang2
	if a != u1 {
		langA, langB = lang2, lang1
	}
	const q = `
		INSERT INTO friends (user_a_id, user_b_id, last_message_at, lang_a, lang_b)
		VALUES ($1, $2, now(), NULLIF($3, ''), NULLIF($4, ''))
		ON CONFLICT (user_a_id, user_b_id) DO UPDATE
		    SET removed_by_a_at = NULL, removed_by_b_at = NULL,
		        lang_a = COALESCE(friends.lang_a, EXCLUDED.lang_a),
		        lang_b = COALESCE(friends.lang_b, EXCLUDED.lang_b)
		RETURNING id, user_a_id, user_b_id, created_at, last_message_at`
	var f Friend
	if err := s.pool.QueryRow(ctx, q, a, b, langA, langB).Scan(
		&f.ID, &f.UserAID, &f.UserBID, &f.CreatedAt, &f.LastMessageAt,
	); err != nil {
		return Friend{}, fmt.Errorf("friends: add: %w", err)
	}
	return f, nil
}

// IsFriend : true si u1 et u2 sont amis (ignore le soft-delete unilatéral
// — le matcher veut savoir s'il y a un lien quel que soit l'état).
func (s *Store) IsFriend(ctx context.Context, u1, u2 int64) (bool, error) {
	a, b := ordered(u1, u2)
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM friends WHERE user_a_id = $1 AND user_b_id = $2)`,
		a, b,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("friends: is friend: %w", err)
	}
	return exists, nil
}

// ListFor : liste les amis visibles pour le user (i.e. NON soft-deleted
// côté caller). Trie par dernier message DESC. Renvoie le PeerID + le
// nombre de messages non lus pour le caller.
//
// Le `unread` est calculé via sous-requête corrélée : pour chaque ligne
// friends, on compte les messages où sender_id != caller_id et sent_at
// > caller.last_read_at. Si last_read_at est NULL (vieille ligne, jamais
// lue), tout compte comme non lu.
func (s *Store) ListFor(ctx context.Context, userID int64) ([]Friend, error) {
	// `last_msg` : sous-requête LATERAL qui renvoie le dernier message
	// (body + sender) de chaque conv. NULL si aucune activité — Go scan
	// dans des pointeurs pour distinguer "rien" vs "string vide". On
	// vide `body` côté SQL si deleted_at est posé (le front affiche alors
	// "Ce message a été supprimé").
	// Le streak "vivant" : current_streak si last_streak_day >= today-1 (UTC),
	// sinon 0. AtRisk : last_streak_day = today-1 ET au moins un côté n'a
	// pas écrit aujourd'hui. lost_streak / lost_at : exposés tels quels
	// pour permettre la restauration côté front.
	const q = `
		WITH today AS (SELECT (now() AT TIME ZONE 'UTC')::date AS d)
		SELECT f.id, f.user_a_id, f.user_b_id, f.created_at, f.last_message_at,
		       f.removed_by_a_at, f.removed_by_b_at, f.lang_a, f.lang_b,
		       COALESCE((
		           SELECT COUNT(*) FROM friend_messages m
		           WHERE m.friend_id = f.id
		             AND m.sender_id <> $1
		             AND m.deleted_at IS NULL
		             AND m.sent_at > COALESCE(
		                 CASE WHEN f.user_a_id = $1 THEN f.last_read_at_a ELSE f.last_read_at_b END,
		                 'epoch'::timestamptz
		             )
		       ), 0) AS unread,
		       last_msg.body,
		       last_msg.sender_id,
		       last_msg.deleted,
		       CASE
		         WHEN fs.last_streak_day IS NULL THEN 0
		         WHEN fs.last_streak_day >= (SELECT d FROM today) - 1 THEN fs.current_streak
		         ELSE 0
		       END AS streak,
		       COALESCE(
		         fs.last_streak_day = (SELECT d FROM today) - 1
		         AND fs.current_streak >= 2
		         AND (fs.last_a_msg_day IS DISTINCT FROM (SELECT d FROM today)
		              OR fs.last_b_msg_day IS DISTINCT FROM (SELECT d FROM today)),
		         false
		       ) AS streak_at_risk,
		       COALESCE(fs.lost_streak, 0) AS lost_streak,
		       fs.lost_at
		FROM friends f
		LEFT JOIN LATERAL (
		    SELECT CASE WHEN deleted_at IS NULL THEN body ELSE '' END AS body,
		           sender_id,
		           deleted_at IS NOT NULL AS deleted
		    FROM friend_messages m
		    WHERE m.friend_id = f.id
		    ORDER BY sent_at DESC
		    LIMIT 1
		) AS last_msg ON true
		LEFT JOIN friend_streaks fs ON fs.friend_id = f.id
		WHERE (f.user_a_id = $1 OR f.user_b_id = $1)
		  AND (CASE WHEN f.user_a_id = $1 THEN f.removed_by_a_at ELSE f.removed_by_b_at END) IS NULL
		ORDER BY f.last_message_at DESC`
	rows, err := s.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("friends: list for: %w", err)
	}
	defer rows.Close()
	out := []Friend{}
	for rows.Next() {
		var f Friend
		var aRem, bRem *time.Time
		var langA, langB *string
		var lastBody *string
		var lastSenderID *int64
		var lastDeleted *bool
		if err := rows.Scan(
			&f.ID, &f.UserAID, &f.UserBID, &f.CreatedAt, &f.LastMessageAt,
			&aRem, &bRem, &langA, &langB, &f.UnreadCount,
			&lastBody, &lastSenderID, &lastDeleted,
			&f.Streak, &f.StreakAtRisk, &f.LostStreak, &f.LostAt,
		); err != nil {
			return nil, fmt.Errorf("friends: scan: %w", err)
		}
		if lastBody != nil {
			f.LastMessageBody = *lastBody
		}
		if lastSenderID != nil {
			f.LastMessageSenderID = *lastSenderID
		}
		if lastDeleted != nil {
			f.LastMessageDeleted = *lastDeleted
		}
		if f.UserAID == userID {
			f.PeerID = f.UserBID
			f.PeerRemovedMe = bRem != nil
			f.PeerLang = deref(langB)
		} else {
			f.PeerID = f.UserAID
			f.PeerRemovedMe = aRem != nil
			f.PeerLang = deref(langA)
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// PeerLastReadAt : timestamp auquel le PEER (= l'autre membre que userID)
// a marqué la conv comme lue. Renvoie nil si jamais lu, ou si l'utilisateur
// n'est pas membre / la conv n'existe pas.
func (s *Store) PeerLastReadAt(ctx context.Context, friendID, userID int64) (*time.Time, error) {
	const q = `
		SELECT CASE WHEN user_a_id = $2 THEN last_read_at_b ELSE last_read_at_a END
		FROM friends
		WHERE id = $1 AND (user_a_id = $2 OR user_b_id = $2)`
	var t *time.Time
	err := s.pool.QueryRow(ctx, q, friendID, userID).Scan(&t)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("friends: peer last read: %w", err)
	}
	return t, nil
}

// MarkRead : repousse le last_read_at du caller à `now()`. Idempotent.
// Appelé automatiquement quand l'utilisateur ouvre /ws/friend/{id}.
func (s *Store) MarkRead(ctx context.Context, friendID, userID int64) error {
	const q = `
		UPDATE friends SET
		    last_read_at_a = CASE WHEN user_a_id = $2 THEN now() ELSE last_read_at_a END,
		    last_read_at_b = CASE WHEN user_b_id = $2 THEN now() ELSE last_read_at_b END
		WHERE id = $1 AND (user_a_id = $2 OR user_b_id = $2)`
	if _, err := s.pool.Exec(ctx, q, friendID, userID); err != nil {
		return fmt.Errorf("friends: mark read: %w", err)
	}
	return nil
}

// Get : par ID, en vérifiant que `userID` est bien membre. Renvoie le
// Friend avec PeerID rempli.
func (s *Store) Get(ctx context.Context, friendID, userID int64) (Friend, error) {
	const q = `
		SELECT id, user_a_id, user_b_id, created_at, last_message_at,
		       removed_by_a_at, removed_by_b_at, lang_a, lang_b
		FROM friends
		WHERE id = $1 AND (user_a_id = $2 OR user_b_id = $2)`
	var f Friend
	var aRem, bRem *time.Time
	var langA, langB *string
	err := s.pool.QueryRow(ctx, q, friendID, userID).Scan(
		&f.ID, &f.UserAID, &f.UserBID, &f.CreatedAt, &f.LastMessageAt,
		&aRem, &bRem, &langA, &langB,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Friend{}, ErrNotFound
		}
		return Friend{}, fmt.Errorf("friends: get: %w", err)
	}
	if f.UserAID == userID {
		f.PeerID = f.UserBID
		f.PeerRemovedMe = bRem != nil
		f.PeerLang = deref(langB)
		if aRem != nil {
			// On s'est nous-mêmes retiré → on ne voit plus ce friend.
			return Friend{}, ErrNotFound
		}
	} else {
		f.PeerID = f.UserAID
		f.PeerRemovedMe = aRem != nil
		f.PeerLang = deref(langA)
		if bRem != nil {
			return Friend{}, ErrNotFound
		}
	}
	return f, nil
}

// Remove : soft-delete unilatéral. Le caller ne voit plus ce friend mais
// le peer le voit encore (suppression discrète). Si les DEUX ont retiré,
// la ligne reste pour préserver l'historique (et permettre un éventuel
// re-add côté admin), mais aucun des deux ne voit la conversation.
func (s *Store) Remove(ctx context.Context, friendID, userID int64) error {
	const q = `
		UPDATE friends SET
		    removed_by_a_at = CASE WHEN user_a_id = $2 THEN now() ELSE removed_by_a_at END,
		    removed_by_b_at = CASE WHEN user_b_id = $2 THEN now() ELSE removed_by_b_at END
		WHERE id = $1 AND (user_a_id = $2 OR user_b_id = $2)`
	res, err := s.pool.Exec(ctx, q, friendID, userID)
	if err != nil {
		return fmt.Errorf("friends: remove: %w", err)
	}
	if res.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListMessages : depuis le plus ancien vers le plus récent. limit/offset
// pour pagination — par défaut on récupère les 200 derniers.
func (s *Store) ListMessages(ctx context.Context, friendID int64, limit int) ([]Message, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	// On prend les N plus récents puis on inverse pour ordre chronologique.
	const q = `
		SELECT id, friend_id, sender_id, body, sent_at, edited_at, deleted_at,
		       kind, COALESCE(payload::text, '')
		FROM friend_messages
		WHERE friend_id = $1
		ORDER BY sent_at DESC
		LIMIT $2`
	rows, err := s.pool.Query(ctx, q, friendID, limit)
	if err != nil {
		return nil, fmt.Errorf("friends: list messages: %w", err)
	}
	defer rows.Close()
	out := []Message{}
	for rows.Next() {
		var m Message
		if err := rows.Scan(
			&m.ID, &m.FriendID, &m.SenderID, &m.Body, &m.SentAt,
			&m.EditedAt, &m.DeletedAt, &m.Kind, &m.Payload,
		); err != nil {
			return nil, fmt.Errorf("friends: scan msg: %w", err)
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Inverse pour chrono ascendant.
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}

// AppendMessage : POST un message, met à jour last_message_at sur friends.
// Trim + truncate sur body. Pas de modération obscène ici (les amis sont
// considérés majeurs + consenting ; on garde la modération uniquement sur
// les chats anonymes où les deux ne se connaissent pas).
// AppendMessageWithStreak : variante qui renvoie aussi l'état streak
// post-update. Conservée séparée d'AppendMessage pour ne pas casser
// les appelants existants qui ne consomment que le message.
func (s *Store) AppendMessageWithStreak(ctx context.Context, friendID, senderID int64, body string) (Message, Streak, error) {
	m, st, err := s.appendInternal(ctx, friendID, senderID, body)
	return m, st, err
}

func (s *Store) AppendMessage(ctx context.Context, friendID, senderID int64, body string) (Message, error) {
	m, _, err := s.appendInternal(ctx, friendID, senderID, body)
	return m, err
}

func (s *Store) appendInternal(ctx context.Context, friendID, senderID int64, body string) (Message, Streak, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return Message{}, Streak{}, fmt.Errorf("friends: body vide")
	}
	if len(body) > MessageMaxLen {
		body = body[:MessageMaxLen]
	}
	// Escape HTML AVANT persistance — défense en profondeur côté serveur
	// (CLAUDE.md règle d'or #2). Le client ré-applique DOMPurify au rendu.
	body = html.EscapeString(body)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Message{}, Streak{}, fmt.Errorf("friends: tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var m Message
	err = tx.QueryRow(ctx,
		`INSERT INTO friend_messages (friend_id, sender_id, body)
		 VALUES ($1, $2, $3)
		 RETURNING id, friend_id, sender_id, body, sent_at, kind`,
		friendID, senderID, body,
	).Scan(&m.ID, &m.FriendID, &m.SenderID, &m.Body, &m.SentAt, &m.Kind)
	if err != nil {
		return Message{}, Streak{}, fmt.Errorf("friends: insert message: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE friends SET last_message_at = now() WHERE id = $1`, friendID,
	); err != nil {
		return Message{}, Streak{}, fmt.Errorf("friends: update last_message_at: %w", err)
	}
	st, err := UpdateStreakOnMessage(ctx, tx, friendID, senderID, m.SentAt)
	if err != nil {
		return Message{}, Streak{}, fmt.Errorf("friends: update streak: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Message{}, Streak{}, fmt.Errorf("friends: commit: %w", err)
	}
	return m, st, nil
}

// RestoreStreak : wrapper transactionnel autour de la fonction
// éponyme dans streaks.go. Centralise la création de la tx pour les
// callers HTTP.
func (s *Store) RestoreStreak(ctx context.Context, friendID, userID int64, now time.Time) (RestoreResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RestoreResult{}, fmt.Errorf("friends: restore tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	res, err := RestoreStreak(ctx, tx, friendID, userID, now)
	if err != nil {
		return RestoreResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return RestoreResult{}, fmt.Errorf("friends: restore commit: %w", err)
	}
	return res, nil
}

// InsertStreakRestoredMessage : pose la ligne système "streak restauré"
// dans le chat (kind=system_streak_restored, payload {"days":N}) et bumpe
// last_message_at. Le sender est l'ami qui a déclenché la restauration —
// l'autre côté reçoit ainsi une notif (l'inbox skip le sender). Renvoie le
// message pour permettre au handler de le pousser en live aux peers.
func (s *Store) InsertStreakRestoredMessage(ctx context.Context, friendID, senderID int64, days int) (Message, error) {
	body := "🔥 Streak de " + strconv.Itoa(days) + " jours restauré"
	payload := `{"days":` + strconv.Itoa(days) + `}`
	var m Message
	if err := s.pool.QueryRow(ctx, `
		INSERT INTO friend_messages (friend_id, sender_id, body, kind, payload)
		VALUES ($1, $2, $3, $4, $5::jsonb)
		RETURNING id, friend_id, sender_id, body, sent_at, kind, COALESCE(payload::text, '')
	`, friendID, senderID, body, MessageKindStreakRestored, payload).Scan(
		&m.ID, &m.FriendID, &m.SenderID, &m.Body, &m.SentAt, &m.Kind, &m.Payload,
	); err != nil {
		return Message{}, fmt.Errorf("friends: insert restored msg: %w", err)
	}
	if _, err := s.pool.Exec(ctx,
		`UPDATE friends SET last_message_at = $2 WHERE id = $1`, friendID, m.SentAt,
	); err != nil {
		return Message{}, fmt.Errorf("friends: bump last_message_at: %w", err)
	}
	return m, nil
}

// QuotaForFriend : nombre de restaurations restantes ce mois UTC pour CETTE
// conversation. Compteur partagé entre les deux amis (3 / mois / friendship).
// Pas de ligne friend_streaks encore (jamais de streak) → quota plein.
func (s *Store) QuotaForFriend(ctx context.Context, friendID int64, now time.Time) int {
	var used int
	var month string
	if err := s.pool.QueryRow(ctx,
		`SELECT restores_used, restores_month FROM friend_streaks WHERE friend_id = $1`,
		friendID,
	).Scan(&used, &month); err != nil {
		return RestoreMonthlyQuota
	}
	if month != monthKeyUTC(now) {
		return RestoreMonthlyQuota
	}
	rem := RestoreMonthlyQuota - used
	if rem < 0 {
		return 0
	}
	return rem
}

// ErrEditWindowClosed : tentative d'édition d'un message > EditWindow
// après son envoi. Mapping côté handler vers une 403 / code applicatif.
var ErrEditWindowClosed = errors.New("friends: fenêtre d'édition expirée")

// EditMessage : remplace le body d'un message à condition que (a) le
// caller en soit l'auteur, (b) il ne soit pas déjà supprimé, et (c) on
// soit toujours dans la fenêtre `EditWindow` depuis l'envoi.
func (s *Store) EditMessage(ctx context.Context, msgID, userID int64, body string) (Message, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return Message{}, fmt.Errorf("friends: body vide")
	}
	if len(body) > MessageMaxLen {
		body = body[:MessageMaxLen]
	}
	body = html.EscapeString(body)
	// Tente l'update directement avec les conditions inline — un seul
	// round-trip, et on lit `RETURNING` pour distinguer "non trouvé"
	// (auteur erroné / supprimé / hors fenêtre) du succès.
	const q = `
		UPDATE friend_messages
		SET body = $3, edited_at = now()
		WHERE id = $1
		  AND sender_id = $2
		  AND deleted_at IS NULL
		  AND kind = 'user'
		  AND sent_at >= now() - $4::interval
		RETURNING id, friend_id, sender_id, body, sent_at, edited_at, deleted_at, kind`
	var m Message
	err := s.pool.QueryRow(ctx, q, msgID, userID, body, EditWindow.String()).Scan(
		&m.ID, &m.FriendID, &m.SenderID, &m.Body, &m.SentAt,
		&m.EditedAt, &m.DeletedAt, &m.Kind,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Message{}, ErrEditWindowClosed
		}
		return Message{}, fmt.Errorf("friends: edit message: %w", err)
	}
	return m, nil
}

// DeleteMessage : soft-delete (le body devient invisible, la ligne reste
// pour l'ordre chronologique + modération). Réservé à l'auteur. Pas de
// fenêtre de temps — on peut supprimer un message qu'on a envoyé il y a
// 3 mois.
func (s *Store) DeleteMessage(ctx context.Context, msgID, userID int64) (Message, error) {
	const q = `
		UPDATE friend_messages
		SET deleted_at = now()
		WHERE id = $1
		  AND sender_id = $2
		  AND deleted_at IS NULL
		  AND kind = 'user'
		RETURNING id, friend_id, sender_id, body, sent_at, edited_at, deleted_at, kind`
	var m Message
	err := s.pool.QueryRow(ctx, q, msgID, userID).Scan(
		&m.ID, &m.FriendID, &m.SenderID, &m.Body, &m.SentAt,
		&m.EditedAt, &m.DeletedAt, &m.Kind,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Message{}, ErrNotFound
		}
		return Message{}, fmt.Errorf("friends: delete message: %w", err)
	}
	return m, nil
}

func ordered(a, b int64) (int64, int64) {
	if a < b {
		return a, b
	}
	return b, a
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
