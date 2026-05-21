-- Phase 3 Step 5 : tracking des messages non lus côté friends.
--   last_read_at_a : timestamp du dernier message lu par user_a
--   last_read_at_b : timestamp du dernier message lu par user_b
-- Symétrique aux removed_by_*_at. Un message est "non lu" pour user X si
-- son sent_at > last_read_at_X et que X n'en est pas l'auteur.

ALTER TABLE friends
    ADD COLUMN last_read_at_a TIMESTAMPTZ,
    ADD COLUMN last_read_at_b TIMESTAMPTZ;

-- Bootstrap : on considère que tous les messages antérieurs à la migration
-- sont lus pour les deux membres — sinon chaque user verrait sa liste se
-- couvrir de pastilles "non lu" au premier déploiement.
UPDATE friends SET last_read_at_a = now(), last_read_at_b = now();
