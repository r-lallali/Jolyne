ALTER TABLE friend_messages
    DROP COLUMN IF EXISTS edited_at,
    DROP COLUMN IF EXISTS deleted_at;
