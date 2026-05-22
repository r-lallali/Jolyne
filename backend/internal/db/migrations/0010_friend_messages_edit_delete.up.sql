-- Phase 3 Step 6 : édition / suppression d'un message ami.
--   edited_at  : timestamp de la dernière modification (NULL si jamais).
--   deleted_at : timestamp de la suppression (NULL = encore visible).
-- La suppression est SOFT — on garde la ligne en DB pour préserver l'ordre
-- chronologique de la conv et pour permettre une future modération admin,
-- mais on ne renvoie plus jamais le body au client.

ALTER TABLE friend_messages
    ADD COLUMN edited_at  TIMESTAMPTZ,
    ADD COLUMN deleted_at TIMESTAMPTZ;
