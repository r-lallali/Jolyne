-- Abonnements Web Push : un user peut s'abonner depuis plusieurs navigateurs
-- / appareils. Chaque ligne = une combinaison (endpoint Web Push, paire de
-- clés p256dh/auth). L'endpoint est unique par appareil → on s'en sert comme
-- contrainte d'unicité pour éviter les doublons sur refresh.

CREATE TABLE push_subscriptions (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint   TEXT   NOT NULL,
    p256dh     TEXT   NOT NULL,
    auth       TEXT   NOT NULL,
    user_agent TEXT   NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (endpoint)
);

CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);
