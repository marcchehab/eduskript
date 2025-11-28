-- Rename user fields to page-centric naming
-- Rename username -> pageSlug (preserving data and unique constraint)
ALTER TABLE "users" RENAME COLUMN "username" TO "pageSlug";

-- Rename webpageDescription -> pageDescription (preserving data)
ALTER TABLE "users" RENAME COLUMN "webpageDescription" TO "pageDescription";

-- Add new pageName field
ALTER TABLE "users" ADD COLUMN "pageName" TEXT;

-- Add pageIcon field for custom page branding
ALTER TABLE "users" ADD COLUMN "pageIcon" TEXT;
