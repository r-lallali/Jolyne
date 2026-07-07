-- Analyse IA de fin de conversation : en plus du vocabulaire (0018), Claude
-- extrait désormais les fautes récurrentes de l'apprenant et une estimation
-- de niveau CECRL. Deux destinations :
--
--   1. users.cefr_score : niveau CECRL estimé sur une échelle numérique
--      continue 1.0 (A1) → 6.0 (C2), lissé en EWMA (0.7*ancien + 0.3*nouveau)
--      à chaque conversation analysée. NULL = jamais estimé. Numérique plutôt
--      que texte pour lisser entre deux niveaux (3.4 ≈ "B1 solide").
--
--   2. learn_review_items : matériau pédagogique dérivé des fautes (forme
--      erronée → forme corrigée + explication), consommé par la « leçon du
--      jour » du mode Cours. Même statut de confidentialité que
--      vocab_entries : on persiste UNIQUEMENT le matériau d'apprentissage
--      dérivé, jamais la transcription (règle d'or #1).

ALTER TABLE users ADD COLUMN cefr_score REAL;

CREATE TABLE learn_review_items (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lang        TEXT NOT NULL,            -- langue apprise (celle de la faute)
    original    TEXT NOT NULL,            -- forme écrite par l'apprenant
    corrected   TEXT NOT NULL,            -- forme corrigée
    note        TEXT NOT NULL DEFAULT '', -- explication courte (langue de l'apprenant)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    consumed_at TIMESTAMPTZ               -- posé quand l'item a servi dans une leçon jouée
);

-- Anti-doublon : la même faute re-commise rafraîchit l'item (et le rend à
-- nouveau consommable) au lieu d'empiler des doublons.
CREATE UNIQUE INDEX learn_review_items_unique
    ON learn_review_items (user_id, lang, original, corrected);

-- Assemblage de la leçon du jour : items non consommés d'un user, plus
-- récents d'abord.
CREATE INDEX learn_review_items_pending
    ON learn_review_items (user_id, lang, created_at DESC)
    WHERE consumed_at IS NULL;
