/*
  Warnings:

  - A unique constraint covering the columns `[page_id,class_id,student_id]` on the table `exam_states` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "exam_states_page_id_class_id_key";

-- AlterTable
ALTER TABLE "exam_states" ADD COLUMN     "student_id" TEXT;

-- CreateIndex
CREATE INDEX "exam_states_student_id_idx" ON "exam_states"("student_id");

-- CreateIndex
-- NULLS NOT DISTINCT (hand-added; Prisma can't express it in-schema) so the
-- class-level row (student_id = NULL) stays unique per (page, class), while
-- per-student override rows are unique per (page, class, student). Requires
-- Postgres >= 15 (prod + dev are PG16).
CREATE UNIQUE INDEX "exam_states_page_id_class_id_student_id_key" ON "exam_states"("page_id", "class_id", "student_id") NULLS NOT DISTINCT;

-- AddForeignKey
ALTER TABLE "exam_states" ADD CONSTRAINT "exam_states_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===== Backfill from the retired PageUnlock model (single source of truth is
-- now ExamState). Idempotent (NOT EXISTS guards). See
-- prisma/manual/unify_exam_state_backfill.sql for notes + the pre-check. =====

-- 1) Class-level unlocks -> ensure a class-level ExamState row (student_id NULL).
INSERT INTO exam_states (id, page_id, class_id, student_id, state, created_at, updated_at)
SELECT gen_random_uuid()::text, pu.page_id, pu.class_id, NULL, 'closed', NOW(), NOW()
FROM page_unlocks pu
WHERE pu.class_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM exam_states es
    WHERE es.page_id = pu.page_id AND es.class_id = pu.class_id AND es.student_id IS NULL
  );

-- 2) Individual student unlocks -> per-student 'open' override (an individual
--    unlock is directly enterable today). class_id = any class the student is in
--    (ExamState.class_id is NOT NULL). Students in no class are skipped.
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
