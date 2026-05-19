DROP INDEX IF EXISTS idx_auth_tokens_user_purpose;
ALTER TABLE auth_tokens DROP COLUMN IF EXISTS purpose;
ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at;
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
