-- Phase 3 Step 2 : password auth (bcrypt) en mode primaire, email confirmé
-- une fois à la création. Les tokens magic link servent désormais à la
-- vérification d'email et au reset de password — typés via `purpose`.

ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;

ALTER TABLE auth_tokens
    ADD COLUMN purpose TEXT NOT NULL DEFAULT 'verify_email';

CREATE INDEX idx_auth_tokens_user_purpose ON auth_tokens(user_id, purpose);
