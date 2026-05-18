-- Phase 3 Step 1 : comptes utilisateur via magic link.
--
--   users        : id auto, email unique. Pas de password. Pas de PII en dur.
--   auth_tokens  : tokens magic link (hash stocké, jamais en clair). TTL court.

CREATE TABLE users (
    id              BIGSERIAL PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ
);

CREATE INDEX idx_users_email_lower ON users(LOWER(email));

CREATE TABLE auth_tokens (
    token_hash      TEXT PRIMARY KEY,             -- sha256(token) hex
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at      TIMESTAMPTZ NOT NULL,
    consumed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_tokens_user_id ON auth_tokens(user_id);
CREATE INDEX idx_auth_tokens_expires ON auth_tokens(expires_at);
