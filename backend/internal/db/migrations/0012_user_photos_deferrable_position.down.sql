ALTER TABLE user_photos
    DROP CONSTRAINT user_photos_user_id_position_key;

ALTER TABLE user_photos
    ADD CONSTRAINT user_photos_user_id_position_key
    UNIQUE (user_id, position);
