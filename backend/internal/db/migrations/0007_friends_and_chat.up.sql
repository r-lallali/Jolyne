-- Phase 3 Step 4 : amitiés bidirectionnelles + historique de messages
-- persisté UNIQUEMENT entre amis (cf. CLAUDE.md règle d'or #1, dérogation
-- explicite Phase 3 — les chats anonymes restent éphémères).
--
--   friends         : 1 ligne par paire d'amis, ids ordonnés (a < b) pour
--                     éviter les doublons. Soft-delete unilatéral via
--                     removed_by_a_at / removed_by_b_at (suppression
--                     discrète : le retiré ne le voit pas).
--   friend_messages : 1-N par friend, sender_id pour savoir qui a écrit.

CREATE TABLE friends (
    id              BIGSERIAL PRIMARY KEY,
    user_a_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    removed_by_a_at TIMESTAMPTZ,
    removed_by_b_at TIMESTAMPTZ,
    CONSTRAINT friends_pair    UNIQUE (user_a_id, user_b_id),
    CONSTRAINT friends_ordered CHECK (user_a_id < user_b_id)
);

CREATE INDEX idx_friends_user_a ON friends(user_a_id);
CREATE INDEX idx_friends_user_b ON friends(user_b_id);

CREATE TABLE friend_messages (
    id         BIGSERIAL PRIMARY KEY,
    friend_id  BIGINT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
    sender_id  BIGINT NOT NULL REFERENCES users(id),
    body       TEXT NOT NULL,
    sent_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_friend_messages_friend_sent
    ON friend_messages(friend_id, sent_at);
