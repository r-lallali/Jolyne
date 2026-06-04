-- Rétablit les compteurs globaux par user (vides — le décompte du mois en
-- cours est perdu, acceptable pour un down).
ALTER TABLE users
    ADD COLUMN streak_restores_used  INT  NOT NULL DEFAULT 0,
    ADD COLUMN streak_restores_month TEXT NOT NULL DEFAULT '';

ALTER TABLE friend_streaks
    DROP COLUMN IF EXISTS restores_used,
    DROP COLUMN IF EXISTS restores_month;
