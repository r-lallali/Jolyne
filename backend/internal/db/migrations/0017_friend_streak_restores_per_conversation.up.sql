-- Le quota de restauration de streak passe d'un compteur GLOBAL par user à
-- un compteur PARTAGÉ par conversation : 3 restaurations par mois et par
-- friendship, consommées par celui des deux amis qui restaure.
--
-- `restores_month` contient 'YYYY-MM' UTC du mois courant — on reset à 0
-- quand le mois change (côté applicatif au moment d'incrémenter).
ALTER TABLE friend_streaks
    ADD COLUMN restores_used  INT  NOT NULL DEFAULT 0,
    ADD COLUMN restores_month TEXT NOT NULL DEFAULT '';

-- Les compteurs globaux par user n'ont plus de raison d'être.
ALTER TABLE users
    DROP COLUMN IF EXISTS streak_restores_used,
    DROP COLUMN IF EXISTS streak_restores_month;
