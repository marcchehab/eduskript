-- Backfill for the "unify exam state" migration: convert the retired PageUnlock
-- model into ExamState rows (the new single source of truth). Append this to the
-- generated migration.sql AFTER the schema DDL (the ADD COLUMN student_id and the
-- new unique index), so the new columns exist when these run.
--
-- Idempotent (guarded by NOT EXISTS), so re-running is safe.

-- 1) Class-level unlocks → ensure a class-level ExamState row. The old
--    auto-create already made 'closed' rows for most; this covers any class
--    unlock that lacked one. student_id NULL = class-level.
INSERT INTO exam_states (id, page_id, class_id, student_id, state, created_at, updated_at)
SELECT gen_random_uuid()::text, pu.page_id, pu.class_id, NULL, 'closed', NOW(), NOW()
FROM page_unlocks pu
WHERE pu.class_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM exam_states es
    WHERE es.page_id = pu.page_id AND es.class_id = pu.class_id AND es.student_id IS NULL
  );

-- 2) Individual student unlocks → per-student 'open' override (today an
--    individual unlock is directly enterable, bypassing state). class_id is any
--    class the student belongs to (ExamState.class_id is NOT NULL). Students in
--    NO class are skipped — run the pre-check below first and confirm it's empty
--    (or acceptable) before applying.
INSERT INTO exam_states (id, page_id, class_id, student_id, state, opened_at, created_at, updated_at)
SELECT gen_random_uuid()::text, pu.page_id,
  (SELECT cm.class_id FROM class_memberships cm WHERE cm.student_id = pu.student_id LIMIT 1),
  pu.student_id, 'open', NOW(), NOW(), NOW()
FROM page_unlocks pu
WHERE pu.student_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM class_memberships cm WHERE cm.student_id = pu.student_id)
  AND NOT EXISTS (
    SELECT 1 FROM exam_states es WHERE es.page_id = pu.page_id AND es.student_id = pu.student_id
  );

-- PRE-CHECK (run BEFORE applying; not part of the migration). Individual unlocks
-- for students with no class membership — these are NOT migrated (the new model
-- can't represent classless access). Expect 0 rows; investigate if not.
--   SELECT pu.page_id, pu.student_id FROM page_unlocks pu
--   WHERE pu.student_id IS NOT NULL
--     AND NOT EXISTS (SELECT 1 FROM class_memberships cm WHERE cm.student_id = pu.student_id);
