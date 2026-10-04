-- CreateTable
-- IF NOT EXISTS added by hand to the generated SQL: scripts/sync-docs.mjs has
-- created this table with raw SQL on every boot since 2026-02-24, so it
-- already exists in prod and in every dev DB. Same shape as generated.
CREATE TABLE IF NOT EXISTS "_sync_metadata" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "_sync_metadata_pkey" PRIMARY KEY ("key")
);
