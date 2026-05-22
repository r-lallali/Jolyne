-- Migration 0011 Down : Système de vérification de photo automatisé
DROP TABLE IF EXISTS photo_verification_attempts;
ALTER TABLE user_profiles DROP COLUMN IF EXISTS is_verified;
