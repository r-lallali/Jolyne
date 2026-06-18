-- Mode Cours, itération 2 : choix du niveau à l'entrée d'un cours + demandes de
-- cœur entre amis (quand l'apprenant n'a plus de vies). Les cœurs illimités du
-- premium sont gérés côté applicatif (pas de colonne — IsPremium suffit).

-- Leçons « placées » par le choix de niveau : marquées comme acquises sans
-- avoir été jouées (débloquent le parcours au bon niveau, affichées sans
-- étoiles).
ALTER TABLE learn_progress
    ADD COLUMN placed BOOLEAN NOT NULL DEFAULT false;

-- Inscription à un cours : mémorise que l'apprenant a choisi son niveau de
-- départ pour cette langue (sinon on lui propose le sélecteur de niveau).
CREATE TABLE learn_enrollments (
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lang       TEXT   NOT NULL,
    start_unit INT    NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, lang)
);

-- Demande de cœur adressée à un ami (1 par jour côté demandeur). L'ami
-- l'accorde et le demandeur gagne +1 cœur. `status` : 'pending' | 'granted'.
CREATE TABLE learn_heart_requests (
    id           BIGSERIAL PRIMARY KEY,
    requester_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       TEXT   NOT NULL DEFAULT 'pending',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at  TIMESTAMPTZ
);

-- Demandes en attente reçues par un user (pour les lui présenter).
CREATE INDEX learn_heart_requests_target
    ON learn_heart_requests (target_id, status);
-- Comptage des demandes émises dans la journée (quota 1/jour).
CREATE INDEX learn_heart_requests_requester_day
    ON learn_heart_requests (requester_id, created_at DESC);
