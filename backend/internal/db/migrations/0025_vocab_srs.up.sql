-- Répétition espacée (SRS) sur le carnet de vocabulaire. Algorithme SM-2
-- adapté (voir internal/vocab/srs.go) : chaque entrée porte son état de
-- révision. Une entrée fraîche est due immédiatement (due_at = now()).
--
--   due_at        : prochaine échéance de révision.
--   ease          : facteur de facilité SM-2 (1.3 .. 3.5), départ 2.5.
--   interval_days : intervalle courant en jours (REAL — les sous-intervalles
--                   « again » repassent en minutes).
--   reps          : révisions réussies consécutives (raz sur « again »).
--   lapses        : nombre total d'oublis (statistique + pénalité d'ease).

ALTER TABLE vocab_entries
    ADD COLUMN due_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN ease          REAL NOT NULL DEFAULT 2.5,
    ADD COLUMN interval_days REAL NOT NULL DEFAULT 0,
    ADD COLUMN reps          INT  NOT NULL DEFAULT 0,
    ADD COLUMN lapses        INT  NOT NULL DEFAULT 0;

-- File de révision : entrées dues d'un user, échéance la plus ancienne d'abord.
CREATE INDEX vocab_entries_due ON vocab_entries (user_id, due_at);

-- Rappel push quotidien « X mots t'attendent » : horodatage du dernier envoi
-- par user (anti-spam : au plus un rappel par ~20 h, voir reminder_cron.go).
ALTER TABLE users ADD COLUMN last_review_reminder_at TIMESTAMPTZ;
