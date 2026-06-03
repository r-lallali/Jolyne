DROP TABLE IF EXISTS stripe_events;
ALTER TABLE users DROP COLUMN IF EXISTS plan;
ALTER TABLE users DROP COLUMN IF EXISTS current_period_end;
ALTER TABLE users DROP COLUMN IF EXISTS subscription_status;
ALTER TABLE users DROP COLUMN IF EXISTS stripe_customer_id;
