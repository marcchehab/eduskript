-- Data-only: remove provider tokens stored by earlier sign-ins. The id_token
-- held the user's email and real name (also for students); access/refresh
-- tokens granted Microsoft Graph access. New sign-ins no longer store them
-- (PrivacyAdapter.linkAccount in src/lib/privacy-adapter.ts).
-- Old row versions stay on disk until autovacuum reclaims them, and pgBackRest
-- backups keep them until those backups expire.
UPDATE "accounts"
SET "id_token" = NULL, "access_token" = NULL, "refresh_token" = NULL, "session_state" = NULL
WHERE "id_token" IS NOT NULL OR "access_token" IS NOT NULL
   OR "refresh_token" IS NOT NULL OR "session_state" IS NOT NULL;
