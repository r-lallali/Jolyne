ALTER TABLE users
    DROP COLUMN IF EXISTS streak_restores_used,
    DROP COLUMN IF EXISTS streak_restores_month;

DROP TABLE IF EXISTS friend_streaks;
