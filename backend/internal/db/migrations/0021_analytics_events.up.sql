-- Analytics produit : journal d'événements append-only pour reconstruire le
-- funnel (visite → inscription → 1er match → 1er message → retour → premium) et
-- la rétention par cohorte. Source de vérité des dashboards /admin.
--
-- Privacy by default (cf. CLAUDE.md) : AUCUN contenu de message, email ou token.
-- Corrélation pré-inscription par hash de fingerprint (anon_id) + ip_hash. Une
-- ligne = un événement métier, son nom est validé contre une allowlist en Go.
--
--   name        : type d'événement (signup_completed, match_found, …).
--   user_id     : NULL tant que l'utilisateur est anonyme. CASCADE = purge RGPD.
--   anon_id     : hash du fingerprint, relie les events anonymes d'un visiteur.
--   session_id  : id de session WS (éphémère) pour recoller une conversation.
--   lang_from / lang_to : paire de langues quand l'event en porte une.
--   props       : métadonnées courtes et non-PII (peer=human|bot, counts…).

CREATE TABLE events (
    id          BIGSERIAL PRIMARY KEY,
    ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
    name        TEXT NOT NULL,
    user_id     BIGINT REFERENCES users(id) ON DELETE CASCADE,
    anon_id     TEXT,
    session_id  TEXT,
    lang_from   TEXT,
    lang_to     TEXT,
    ip_hash     TEXT,
    props       JSONB
);

-- Séries temporelles & comptages par type d'événement (overview, timeseries).
CREATE INDEX idx_events_name_ts ON events (name, ts DESC);

-- Funnel & rétention côté comptes : première occurrence d'une étape par user.
CREATE INDEX idx_events_user_ts ON events (user_id, ts) WHERE user_id IS NOT NULL;

-- Funnel côté visiteurs anonymes (avant inscription).
CREATE INDEX idx_events_anon_ts ON events (anon_id, ts) WHERE anon_id IS NOT NULL;

-- Balayages par plage de dates sur une grosse table append-only : BRIN suffit
-- et reste quasi gratuit en écriture (les lignes arrivent dans l'ordre du temps).
CREATE INDEX idx_events_ts_brin ON events USING BRIN (ts);
