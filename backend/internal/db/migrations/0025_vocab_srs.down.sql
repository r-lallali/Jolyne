ALTER TABLE users DROP COLUMN last_review_reminder_at;
DROP INDEX vocab_entries_due;
ALTER TABLE vocab_entries
    DROP COLUMN due_at,
    DROP COLUMN ease,
    DROP COLUMN interval_days,
    DROP COLUMN reps,
    DROP COLUMN lapses;
