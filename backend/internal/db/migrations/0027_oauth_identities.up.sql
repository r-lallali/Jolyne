-- OAuth social login (Google / Apple).
--
--   user_identities : 1 ligne par identité fédérée liée à un compte.
--     provider = 'google' | 'apple', subject = claim `sub` OIDC (stable,
--     jamais l'email — Google documente que le sub est le seul identifiant
--     pérenne, l'email peut changer). PK (provider, subject) : une identité
--     ne peut être liée qu'à un seul compte ; un compte peut avoir
--     plusieurs identités (Google ET Apple).
--
-- Les comptes créés via OAuth ont password_hash NULL (déjà supporté) et
-- email_verified_at posé si le provider atteste l'adresse.

CREATE TABLE user_identities (
    provider   TEXT NOT NULL,
    subject    TEXT NOT NULL,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject)
);

CREATE INDEX idx_user_identities_user ON user_identities(user_id);
