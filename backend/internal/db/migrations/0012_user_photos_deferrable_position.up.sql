-- Rend la contrainte UNIQUE (user_id, position) DEFERRABLE pour permettre
-- les swaps atomiques pendant un reorder. La contrainte reste INITIALLY
-- IMMEDIATE — il faut SET CONSTRAINTS … DEFERRED dans la transaction de
-- reorder pour la différer jusqu'au COMMIT.
ALTER TABLE user_photos
    DROP CONSTRAINT user_photos_user_id_position_key;

ALTER TABLE user_photos
    ADD CONSTRAINT user_photos_user_id_position_key
    UNIQUE (user_id, position) DEFERRABLE INITIALLY IMMEDIATE;
