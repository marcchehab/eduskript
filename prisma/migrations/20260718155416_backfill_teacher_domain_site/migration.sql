-- Backfill: link legacy teacher custom domains (created before per-site domains)
-- to each user's primary site (lowest `order`, ties oldest). After this, every
-- teacher custom domain carries a siteId, so canonical/SEO/resolution can read
-- the site's domains via the back-relation without a null-site fallback.
UPDATE "teacher_custom_domains" tcd
SET "site_id" = (
  SELECT s."id"
  FROM "sites" s
  WHERE s."user_id" = tcd."user_id"
  ORDER BY s."order" ASC, s."created_at" ASC
  LIMIT 1
)
WHERE tcd."site_id" IS NULL;
