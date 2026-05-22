-- Migration 0011 : Système de vérification de photo automatisé
-- Ajout du flag de certification dans la table des profils :
ALTER TABLE user_profiles ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT false;

-- Ajout d'une table d'audit des tentatives :
CREATE TABLE photo_verification_attempts (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status          TEXT NOT NULL, -- 'success', 'failed'
    confidence      REAL NOT NULL, -- score de similarité retourné par le moteur
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_photo_verification_attempts_user ON photo_verification_attempts(user_id);
