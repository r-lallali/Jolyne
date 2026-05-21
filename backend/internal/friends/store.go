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
}

type Message struct {
	ID       int64
	FriendID int64
	SenderID int64
	Body     string
	SentAt   time.Time
}

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// Add : crée le lien d'amitié (ou no-op si déjà existant). Renvoie le
// Friend avec son ID. Les user IDs sont ordonnés en interne pour respecter
// la contrainte user_a < user_b.
func (s *Store) Add(ctx context.Context, u1, u2 int64) (Friend, error) {
	if u1 == u2 {
		return Friend{}, fmt.Errorf("friends: same user")
	}
	a, b := ordered(u1, u2)
	const q = `
		INSERT INTO friends (user_a_id, user_b_id, last_message_at)
		VALUES ($1, $2, now())
		ON CONFLICT (user_a_id, user_b_id) DO UPDATE
		    SET removed_by_a_at = NULL, removed_by_b_at = NULL
		RETURNING id, user_a_id, user_b_id, created_at, last_message_at`
	var f Friend
	if err := s.pool.QueryRow(ctx, q, a, b).Scan(
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
// côté caller). Trie par dernier message DESC. Renvoie le PeerID dans
// chaque Friend pour faciliter l'UI.
func (s *Store) ListFor(ctx context.Context, userID int64) ([]Friend, error) {
	const q = `
		SELECT id, user_a_id, user_b_id, created_at, last_message_at,
		       removed_by_a_at, removed_by_b_at
		FROM friends
		WHERE (user_a_id = $1 OR user_b_id = $1)
		  AND (CASE WHEN user_a_id = $1 THEN removed_by_a_at ELSE removed_by_b_at END) IS NULL
		ORDER BY last_message_at DESC`
	rows, err := s.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("friends: list for: %w", err)
	}
	defer rows.Close()
	out := []Friend{}
	for rows.Next() {
		var f Friend
		var aRem, bRem *time.Time
		if err := rows.Scan(
			&f.ID, &f.UserAID, &f.UserBID, &f.CreatedAt, &f.LastMessageAt,
			&aRem, &bRem,
		); err != nil {
			return nil, fmt.Errorf("friends: scan: %w", err)
		}
		if f.UserAID == userID {
			f.PeerID = f.UserBID
			f.PeerRemovedMe = bRem != nil
		} else {
			f.PeerID = f.UserAID
			f.PeerRemovedMe = aRem != nil
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// Get : par ID, en vérifiant que `userID` est bien membre. Renvoie le
// Friend avec PeerID rempli.
func (s *Store) Get(ctx context.Context, friendID, userID int64) (Friend, error) {
	const q = `
		SELECT id, user_a_id, user_b_id, created_at, last_message_at,
		       removed_by_a_at, removed_by_b_at
		FROM friends
		WHERE id = $1 AND (user_a_id = $2 OR user_b_id = $2)`
	var f Friend
	var aRem, bRem *time.Time
	err := s.pool.QueryRow(ctx, q, friendID, userID).Scan(
		&f.ID, &f.UserAID, &f.UserBID, &f.CreatedAt, &f.LastMessageAt,
		&aRem, &bRem,
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
		if aRem != nil {
			// On s'est nous-mêmes retiré → on ne voit plus ce friend.
			return Friend{}, ErrNotFound
		}
	} else {
		f.PeerID = f.UserAID
		f.PeerRemovedMe = aRem != nil
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
		SELECT id, friend_id, sender_id, body, sent_at
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
		if err := rows.Scan(&m.ID, &m.FriendID, &m.SenderID, &m.Body, &m.SentAt); err != nil {
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
func (s *Store) AppendMessage(ctx context.Context, friendID, senderID int64, body string) (Message, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return Message{}, fmt.Errorf("friends: body vide")
	}
	if len(body) > MessageMaxLen {
		body = body[:MessageMaxLen]
	}
	// Escape HTML AVANT persistance — défense en profondeur côté serveur
	// (CLAUDE.md règle d'or #2). Le client ré-applique DOMPurify au rendu.
	body = html.EscapeString(body)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Message{}, fmt.Errorf("friends: tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var m Message
	err = tx.QueryRow(ctx,
		`INSERT INTO friend_messages (friend_id, sender_id, body)
		 VALUES ($1, $2, $3)
		 RETURNING id, friend_id, sender_id, body, sent_at`,
		friendID, senderID, body,
	).Scan(&m.ID, &m.FriendID, &m.SenderID, &m.Body, &m.SentAt)
	if err != nil {
		return Message{}, fmt.Errorf("friends: insert message: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE friends SET last_message_at = now() WHERE id = $1`, friendID,
	); err != nil {
		return Message{}, fmt.Errorf("friends: update last_message_at: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Message{}, fmt.Errorf("friends: commit: %w", err)
	}
	return m, nil
}

func ordered(a, b int64) (int64, int64) {
	if a < b {
		return a, b
	}
	return b, a
}
