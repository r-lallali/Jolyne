-- Messages "système" dans le chat ami : événements permanents insérés par
-- le serveur dans le flux de messages (perte de streak, etc.). Distincts
-- des messages utilisateur — rendus différemment côté front, pas
-- éditables / supprimables.
--
-- `kind`     : 'user' (par défaut, message classique) ou un identifiant
--              d'événement système (ex. 'system_streak_lost').
-- `payload`  : JSON optionnel (ex. {"days": 12}) pour les events système.
--              Vide pour les messages utilisateur.
-- `sender_id` : conservé NOT NULL pour ne pas casser la FK ; on stocke
--               l'un des deux user_id du friendship pour les messages
--               système (au choix, le front ne s'en sert pas — il s'aligne
--               sur `kind`).

ALTER TABLE friend_messages
    ADD COLUMN kind    TEXT NOT NULL DEFAULT 'user',
    ADD COLUMN payload JSONB;

-- `lost_notified_at` : posé par le cron quand il a inséré la ligne
-- système matérialisant la perte du streak courant. Garantit l'unicité
-- de la notification (pas de doublon si le cron re-passe). Reset à NULL
-- au moment où un nouveau streak ≥ 2 est gagné puis perdu à nouveau.
ALTER TABLE friend_streaks
    ADD COLUMN lost_notified_at TIMESTAMPTZ;
