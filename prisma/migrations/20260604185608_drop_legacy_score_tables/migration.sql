-- Backfill the two legacy score-source tables into the unified component_scores
-- table BEFORE dropping them, so the copy is atomic with the drop on every
-- environment (no dependence on running scripts/backfill-component-scores.mjs
-- first). Idempotent: ON CONFLICT DO NOTHING, so rows the script already copied
-- on dev are not duplicated. check -> priority 10, override -> priority 100.
INSERT INTO "component_scores"
  (id, page_id, student_id, component_id, source, priority, earned, max, feedback, meta, created_by, created_at, updated_at)
SELECT
  'c' || replace(gen_random_uuid()::text, '-', ''),
  page_id, student_id, component_id, 'check', 10,
  earned, max, NULL,
  jsonb_build_object('passed', passed, 'total', total),
  ran_by, ran_at, ran_at
FROM "exam_check_runs"
ON CONFLICT (page_id, student_id, component_id, source) DO NOTHING;

INSERT INTO "component_scores"
  (id, page_id, student_id, component_id, source, priority, earned, max, feedback, meta, created_by, created_at, updated_at)
SELECT
  'c' || replace(gen_random_uuid()::text, '-', ''),
  page_id, student_id, component_id, 'override', 100,
  awarded_points, max_points, feedback,
  NULL,
  graded_by, created_at, updated_at
FROM "exam_question_grades"
ON CONFLICT (page_id, student_id, component_id, source) DO NOTHING;

-- DropForeignKey
ALTER TABLE "exam_check_runs" DROP CONSTRAINT "exam_check_runs_page_id_fkey";

-- DropForeignKey
ALTER TABLE "exam_check_runs" DROP CONSTRAINT "exam_check_runs_student_id_fkey";

-- DropForeignKey
ALTER TABLE "exam_question_grades" DROP CONSTRAINT "exam_question_grades_page_id_fkey";

-- DropForeignKey
ALTER TABLE "exam_question_grades" DROP CONSTRAINT "exam_question_grades_student_id_fkey";

-- DropTable
DROP TABLE "exam_check_runs";

-- DropTable
DROP TABLE "exam_question_grades";
