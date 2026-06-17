-- Carnet de vocabulaire : mots sauvegardés depuis le popover de traduction.
-- Première brique de rétention (révision ultérieure). Une ligne = un terme
-- traduit, rattaché à un user. La paire de langues est figée à la sauvegarde
-- (le même mot peut être appris dans deux sens : en→fr et fr→en).
--
--   term         : texte source sélectionné par le user (déjà HTML-escapé).
--   translation  : traduction renvoyée par /api/translate.
--   source_lang  : langue du terme (code court, jamais 'auto').
--   target_lang  : langue de la traduction.

CREATE TABLE vocab_entries (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    term        TEXT NOT NULL,
    translation TEXT NOT NULL,
    source_lang TEXT NOT NULL,
    target_lang TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Anti-doublon : re-sauvegarder le même terme dans le même sens est idempotent
-- (ON CONFLICT côté store rafraîchit created_at au lieu d'insérer un doublon).
CREATE UNIQUE INDEX vocab_entries_unique
    ON vocab_entries (user_id, term, source_lang, target_lang);

-- Listing : tout le carnet d'un user, du plus récent au plus ancien.
CREATE INDEX vocab_entries_user_recent
    ON vocab_entries (user_id, created_at DESC);
