-- Teachers registered before opt-in existed (30 Oct 2026) were on the old
-- Brevo product-update list; keep them subscribed (opt-out via the link in
-- every mail). No consent timestamp: they did not opt in. Same filter as
-- mailableTeacherWhere() in src/lib/product-updates/service.ts.
UPDATE "users"
SET "product_updates" = true
WHERE "accountType" = 'teacher'
  AND "is_temporary" = false
  AND "email" IS NOT NULL
  AND "email" NOT LIKE '%@eduskript.local'
  AND ("emailVerified" IS NOT NULL OR "hashedPassword" IS NULL)
  AND "createdAt" < '2026-10-30T00:00:00Z';
