ALTER TABLE friend_messages
    DROP COLUMN IF EXISTS payload,
    DROP COLUMN IF EXISTS kind;

ALTER TABLE friend_streaks
    DROP COLUMN IF EXISTS lost_notified_at;
