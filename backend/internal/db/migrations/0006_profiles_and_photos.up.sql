-- Phase 3 Step 3 : profil utilisateur + photos hébergées sur Cloudinary.
--   user_profiles : 1-1 avec users (clé primaire = user_id).
--   user_photos   : jusqu'à 6 par user, position 1 = principale visible
--                   à côté du chat (style Hinge).

CREATE TABLE user_profiles (
    user_id      BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL DEFAULT '',
    bio          TEXT NOT NULL DEFAULT '',
    birthdate    DATE,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_photos (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- position 1..6 ; la 1 est l'avatar visible dans le chat.
    position   SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 6),
    -- Cloudinary public_id (ex: "jolyne/avatars/abc123"). Le secure_url
    -- est construit côté front via cloud_name + public_id.
    public_id  TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, position)
);

CREATE INDEX idx_user_photos_user ON user_photos(user_id);
