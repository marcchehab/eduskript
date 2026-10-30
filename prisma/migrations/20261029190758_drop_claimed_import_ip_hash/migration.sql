-- Data-only: claimed imports belong to an account; their IP hash was only
-- needed for the per-IP limits on anonymous imports (src/lib/script-import).
UPDATE "script_imports" SET "ip_hash" = '' WHERE "claimed_at" IS NOT NULL AND "ip_hash" <> '';
