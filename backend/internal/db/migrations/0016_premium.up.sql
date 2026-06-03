-- Phase 3 §Monétisation : abonnement Premium via Stripe.
--
-- La source de vérité de l'abonnement reste Stripe ; on miroite son état sur
-- la ligne user pour pouvoir résoudre le plan sans appel réseau à chaque WS.
--   stripe_customer_id  : 1 customer Stripe par user (créé au 1er checkout).
--   subscription_status : statut Stripe (active|trialing|past_due|canceled…).
--   current_period_end  : fin de période payée — borne le droit Premium.
--   plan                : cache dérivé ('free'|'premium'), lisible directement.

ALTER TABLE users ADD COLUMN stripe_customer_id  TEXT UNIQUE;
ALTER TABLE users ADD COLUMN subscription_status TEXT;
ALTER TABLE users ADD COLUMN current_period_end  TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN plan                TEXT NOT NULL DEFAULT 'free';

-- Idempotence des webhooks : Stripe peut rejouer un event. On enregistre les
-- IDs déjà traités pour ne jamais appliquer deux fois le même effet
-- (cf. PLAN.md §7 « Stripe webhook raté = abonné qui paye sans accès »).
CREATE TABLE stripe_events (
    event_id    TEXT PRIMARY KEY,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
