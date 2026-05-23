-- Streaks bilatéraux entre amis (style TikTok). Une ligne par friendship.
-- La logique :
--   * `current_streak` ne reflète l'état "vivant" que si last_streak_day est
--     aujourd'hui ou hier UTC ; au-delà le streak est considéré expiré (lazy
--     check côté SELECT, on garde la valeur en DB pour la restauration).
--   * `last_milestone` évite de re-notifier le même palier après une perte/
--     restauration.
--   * `lost_streak` / `lost_at` snapshot du streak perdu pour permettre une
--     restauration dans une fenêtre de 7 jours.
--   * `restore_req_a_at` / `restore_req_b_at` : demandes en attente. Quand
--     les deux sont posées dans la fenêtre, on consomme 1 jeton chacun et
--     on restaure.

CREATE TABLE friend_streaks (
    friend_id        BIGINT PRIMARY KEY REFERENCES friends(id) ON DELETE CASCADE,
    current_streak   INT  NOT NULL DEFAULT 0,
    last_streak_day  DATE,
    last_a_msg_day   DATE,
    last_b_msg_day   DATE,
    last_milestone   INT  NOT NULL DEFAULT 0,
    lost_streak      INT,
    lost_at          DATE,
    restore_req_a_at TIMESTAMPTZ,
    restore_req_b_at TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Compteur mensuel de restaurations par user. `streak_restores_month`
-- contient 'YYYY-MM' UTC du mois courant — on reset à 0 quand le mois
-- change (côté applicatif au moment d'incrémenter).
ALTER TABLE users
    ADD COLUMN streak_restores_used INT NOT NULL DEFAULT 0,
    ADD COLUMN streak_restores_month TEXT NOT NULL DEFAULT '';
