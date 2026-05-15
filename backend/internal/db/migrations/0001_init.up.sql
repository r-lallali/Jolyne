-- Schéma initial Phase 2 : modération + audit.
-- Volontairement minimal — pas d'utilisateurs/abonnements (Phase 3).

-- Signalements émis par les utilisateurs en cours de chat.
-- Les messages capturés sont stockés CHIFFRÉS (AES-GCM côté app, clé en env).
CREATE TABLE reports (
    id BIGSERIAL PRIMARY KEY,
    reporter_session       TEXT NOT NULL,
    reporter_fingerprint   TEXT NOT NULL,
    reporter_ip_hash       TEXT NOT NULL,
    reported_session       TEXT NOT NULL,
    reported_fingerprint   TEXT NOT NULL,
    reported_nick          TEXT NOT NULL,
    reason                 TEXT,
    captured_messages      BYTEA NOT NULL,  -- chiffré applicatif (AES-GCM)
    status                 TEXT NOT NULL DEFAULT 'open',
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at            TIMESTAMPTZ,
    resolved_by            TEXT,
    resolution_note        TEXT,
    CONSTRAINT reports_status_chk CHECK (status IN ('open','resolved','dismissed'))
);
CREATE INDEX idx_reports_status_created ON reports(status, created_at DESC);
CREATE INDEX idx_reports_reported_fingerprint ON reports(reported_fingerprint);

-- Bannissements multi-axes (IP hashée, fingerprint, futur userId).
-- L'expiration NULL = permanent (réservé au prononcé par modérateur humain).
CREATE TABLE bans (
    id BIGSERIAL PRIMARY KEY,
    target_type            TEXT NOT NULL,
    target_value           TEXT NOT NULL,
    reason                 TEXT,
    banned_by              TEXT NOT NULL,
    expires_at             TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    related_report_id      BIGINT REFERENCES reports(id) ON DELETE SET NULL,
    CONSTRAINT bans_target_type_chk CHECK (target_type IN ('ip','fingerprint','user'))
);
CREATE INDEX idx_bans_target ON bans(target_type, target_value);
CREATE INDEX idx_bans_expires ON bans(expires_at);

-- Audit log de toutes les actions admin (qui a fait quoi, quand, pourquoi).
-- Append-only — jamais d'UPDATE/DELETE en code applicatif.
CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    actor                  TEXT NOT NULL,
    action                 TEXT NOT NULL,
    target_type            TEXT,
    target_value           TEXT,
    reason                 TEXT,
    ip_hash                TEXT NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX idx_audit_log_actor ON audit_log(actor);
