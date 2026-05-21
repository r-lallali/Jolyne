ALTER TABLE friends
    DROP COLUMN IF EXISTS last_read_at_a,
    DROP COLUMN IF EXISTS last_read_at_b;
