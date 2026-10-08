/*
  Warnings:

  - A unique constraint covering the columns `[page_id,student_id,component_id,source,site_id]` on the table `component_scores` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[page_id,student_id,site_id]` on the table `exam_submissions` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[user_id,site_id,adapter,item_id,target_type,target_id]` on the table `user_data` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "component_scores_page_id_student_id_component_id_source_key";

-- DropIndex
DROP INDEX "exam_submissions_page_id_student_id_key";

-- DropIndex
DROP INDEX "user_data_user_id_adapter_item_id_target_type_target_id_key";

-- AlterTable
ALTER TABLE "component_scores" ADD COLUMN     "site_id" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "exam_audit_logs" ADD COLUMN     "site_id" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "exam_sessions" ADD COLUMN     "site_id" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "exam_states" ADD COLUMN     "site_id" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "exam_submissions" ADD COLUMN     "site_id" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "user_data" ADD COLUMN     "site_id" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "user_data_checkpoints" ADD COLUMN     "site_id" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "component_scores_page_id_site_id_idx" ON "component_scores"("page_id", "site_id");

-- CreateIndex
CREATE UNIQUE INDEX "component_scores_page_id_student_id_component_id_source_sit_key" ON "component_scores"("page_id", "student_id", "component_id", "source", "site_id");

-- CreateIndex
CREATE INDEX "exam_audit_logs_page_id_site_id_student_id_occurred_at_idx" ON "exam_audit_logs"("page_id", "site_id", "student_id", "occurred_at");

-- CreateIndex
CREATE INDEX "exam_submissions_site_id_idx" ON "exam_submissions"("site_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_submissions_page_id_student_id_site_id_key" ON "exam_submissions"("page_id", "student_id", "site_id");

-- CreateIndex
CREATE INDEX "user_data_site_id_item_id_idx" ON "user_data"("site_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_data_user_id_site_id_adapter_item_id_target_type_targe_key" ON "user_data"("user_id", "site_id", "adapter", "item_id", "target_type", "target_id");

-- CreateIndex
CREATE INDEX "user_data_checkpoints_site_id_page_id_idx" ON "user_data_checkpoints"("site_id", "page_id");

-- ===========================================================================
-- Data migration (appended by hand to the generated migration, see
-- SITE-SCOPING.md): assign every existing presentation row the site its
-- skript is placed on. Rows whose skript is placed nowhere keep site_id = ''
-- (invisible on every site, still in the DB).
--
-- Placement = the skript is a root item of the site's PageLayout, OR it is in a
-- collection owned by the site, OR in a collection referenced by the site's
-- PageLayout (org layouts may reference an admin's personal collection).
-- Same rule as src/lib/site-access.ts (getPlacementSiteIdsForSkript).
--
-- Multi-placed skripts: pick deterministically, preferring
--   0) a site owned by the row's subject user (author/teacher writing on their site),
--   1) a site owned by a teacher of a class the subject user is a member of,
--   2) anything else; ties by sites.created_at, sites.id.
-- ===========================================================================

CREATE TEMP TABLE _skript_sites AS
  SELECT pli.content_id AS skript_id, pl.site_id
    FROM page_layout_items pli
    JOIN page_layouts pl ON pl.id = pli.page_layout_id
   WHERE pli.type = 'skript'
  UNION
  SELECT cs."skriptId", c.site_id
    FROM collection_skripts cs
    JOIN collections c ON c.id = cs."collectionId"
  UNION
  SELECT cs."skriptId", pl.site_id
    FROM page_layout_items pli
    JOIN page_layouts pl ON pl.id = pli.page_layout_id
    JOIN collection_skripts cs ON cs."collectionId" = pli.content_id
   WHERE pli.type = 'collection';

CREATE FUNCTION pg_temp.site_scoping_pick(p_skript_id text, p_user_id text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT s.id
    FROM _skript_sites ss
    JOIN sites s ON s.id = ss.site_id
   WHERE ss.skript_id = p_skript_id
   ORDER BY
     CASE
       WHEN s.user_id IS NOT NULL AND s.user_id = p_user_id THEN 0
       WHEN s.user_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM class_memberships m JOIN classes c ON c.id = m.class_id
          WHERE m.student_id = p_user_id AND c.teacher_id = s.user_id
       ) THEN 1
       ELSE 2
     END,
     s.created_at, s.id
   LIMIT 1
$$;

-- user_data: item_id is a page id, a front page id, or a skript id (skript-
-- scoped python imports). Site front pages map straight to their site.
UPDATE user_data ud SET site_id = fp.site_id
  FROM front_pages fp
 WHERE fp.id = ud.item_id AND fp.site_id IS NOT NULL;

UPDATE user_data ud SET site_id = COALESCE(pg_temp.site_scoping_pick(p."skriptId", ud.user_id), '')
  FROM pages p
 WHERE p.id = ud.item_id;

UPDATE user_data ud SET site_id = COALESCE(pg_temp.site_scoping_pick(fp.skript_id, ud.user_id), '')
  FROM front_pages fp
 WHERE fp.id = ud.item_id AND fp.skript_id IS NOT NULL;

UPDATE user_data ud SET site_id = COALESCE(pg_temp.site_scoping_pick(sk.id, ud.user_id), '')
  FROM skripts sk
 WHERE sk.id = ud.item_id;

-- Page-keyed tables.
UPDATE user_data_checkpoints t SET site_id = COALESCE(pg_temp.site_scoping_pick(p."skriptId", t.user_id), '')
  FROM pages p WHERE p.id = t.page_id;

UPDATE exam_submissions t SET site_id = COALESCE(pg_temp.site_scoping_pick(p."skriptId", t.student_id), '')
  FROM pages p WHERE p.id = t.page_id;

UPDATE component_scores t SET site_id = COALESCE(pg_temp.site_scoping_pick(p."skriptId", t.student_id), '')
  FROM pages p WHERE p.id = t.page_id;

UPDATE exam_audit_logs t SET site_id = COALESCE(pg_temp.site_scoping_pick(p."skriptId", t.student_id), '')
  FROM pages p WHERE p.id = t.page_id;

UPDATE exam_sessions t SET site_id = COALESCE(pg_temp.site_scoping_pick(p."skriptId", t.user_id), '')
  FROM pages p WHERE p.id = t.page_id;

-- Exam assignments: the class teacher is the subject (their own site wins).
UPDATE exam_states t SET site_id = COALESCE(pg_temp.site_scoping_pick(p."skriptId", c.teacher_id), '')
  FROM pages p, classes c WHERE p.id = t.page_id AND c.id = t.class_id;

DROP FUNCTION pg_temp.site_scoping_pick(text, text);
DROP TABLE _skript_sites;
