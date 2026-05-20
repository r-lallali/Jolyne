-- Phase 3 Step 4 : trois prompts de profil style Hinge.
--   prompt_N : clé i18n d'un prompt fermé (ex: "two_truths_one_lie")
--   answer_N : réponse rédigée par l'user (≤ 200 chars validé en Go)
-- Nullable : les 3 slots sont optionnels, l'user peut n'en remplir aucun.

ALTER TABLE user_profiles
    ADD COLUMN prompt_1 TEXT NOT NULL DEFAULT '',
    ADD COLUMN answer_1 TEXT NOT NULL DEFAULT '',
    ADD COLUMN prompt_2 TEXT NOT NULL DEFAULT '',
    ADD COLUMN answer_2 TEXT NOT NULL DEFAULT '',
    ADD COLUMN prompt_3 TEXT NOT NULL DEFAULT '',
    ADD COLUMN answer_3 TEXT NOT NULL DEFAULT '';
