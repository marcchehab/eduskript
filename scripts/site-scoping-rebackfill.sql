-- Post-deploy re-run of the site-scoping backfill (bughunt #10).
-- Rows written by the OLD container during the rolling deploy have
-- site_id = ''. This assigns them exactly like the migration did and touches
-- only rows with site_id = '' (idempotent). Run once after the new container
-- is serving:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/site-scoping-rebackfill.sql
-- Keep in sync with prisma/migrations/20261008222107_site_scoping/migration.sql.
BEGIN;
-- ===========================================================================
-- Data migration (appended by hand to the generated migration, see
-- SITE-SCOPING.md): assign every existing presentation row the site its
-- skript is placed on. Rows whose skript is placed nowhere keep site_id = ''
-- (invisible on every site, still in the DB).
--
-- Every UPDATE only touches rows with site_id = '', so this block is
-- idempotent and is ALSO shipped as scripts/site-scoping-rebackfill.sql to be
-- re-run after the deploy (rows written by the old container during the
-- rolling deploy land with site_id = '' — bughunt #10).
--
-- Placement = the skript is a root item of the site's PageLayout, OR it is in a
-- collection owned by the site, OR in a collection referenced by the site's
-- PageLayout (org layouts may reference an admin's personal collection).
-- Same rule as src/lib/site-access.ts (getPlacementSiteIdsForSkript).
--
-- Pick for a row of subject user U (site_scoping_pick):
--   0) a placing site owned by U (author/teacher writing on their site),
--   1) a placing site owned by a teacher of a class U is a member of,
--   -) bughunt #9: if U is a skript author, or in a class of a skript author,
--      who owns NO placing site, the row was produced through that author's
--      own slug (the old code served a skript under every author's slug).
--      Handing it to another teacher's site would leak it → stays '' instead,
--   2) else the oldest placing site (created_at, id).
-- Exam rows (bughunt #21) first follow the site of the ExamState that
-- assigned the exam to the student (override row, else a class row of one of
-- their classes), when that site places the skript.
-- Multi-placed skripts across an org site and an admin's personal site stay
-- ambiguous (bughunts #18/#20) — the pre-check in SITE-SCOPING.md lists them.
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
LANGUAGE plpgsql STABLE AS $$
DECLARE
  picked text;
BEGIN
  -- Tier 0 / 1.
  SELECT s.id INTO picked
    FROM _skript_sites ss
    JOIN sites s ON s.id = ss.site_id
   WHERE ss.skript_id = p_skript_id
     AND s.user_id IS NOT NULL
     AND (
       s.user_id = p_user_id
       OR EXISTS (
         SELECT 1 FROM class_memberships m JOIN classes c ON c.id = m.class_id
          WHERE m.student_id = p_user_id AND c.teacher_id = s.user_id
       )
     )
   ORDER BY CASE WHEN s.user_id = p_user_id THEN 0 ELSE 1 END, s.created_at, s.id
   LIMIT 1;
  IF picked IS NOT NULL THEN
    RETURN picked;
  END IF;

  -- Bughunt #9: produced via a co-author's own (non-placing) slug → no site.
  IF EXISTS (
    SELECT 1 FROM skript_authors sa
     WHERE sa."skriptId" = p_skript_id
       AND (
         sa."userId" = p_user_id
         OR EXISTS (
           SELECT 1 FROM class_memberships m JOIN classes c ON c.id = m.class_id
            WHERE m.student_id = p_user_id AND c.teacher_id = sa."userId"
         )
       )
       AND NOT EXISTS (
         SELECT 1 FROM _skript_sites ss JOIN sites s ON s.id = ss.site_id
          WHERE ss.skript_id = p_skript_id AND s.user_id = sa."userId"
       )
  ) THEN
    RETURN NULL;
  END IF;

  -- Tier 2.
  SELECT s.id INTO picked
    FROM _skript_sites ss
    JOIN sites s ON s.id = ss.site_id
   WHERE ss.skript_id = p_skript_id
   ORDER BY s.created_at, s.id
   LIMIT 1;
  RETURN picked;
END
$$;

-- Bughunt #21: exam rows follow the student's exam assignment when its site
-- places the skript. Run AFTER exam_states got their site.
CREATE FUNCTION pg_temp.site_scoping_pick_exam(p_page_id text, p_skript_id text, p_student_id text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT es.site_id
       FROM exam_states es
      WHERE es.page_id = p_page_id
        AND es.site_id <> ''
        AND es.site_id IN (SELECT site_id FROM _skript_sites WHERE skript_id = p_skript_id)
        AND (
          es.student_id = p_student_id
          OR (es.student_id IS NULL AND EXISTS (
                SELECT 1 FROM class_memberships m WHERE m.class_id = es.class_id AND m.student_id = p_student_id))
        )
      ORDER BY CASE WHEN es.student_id IS NULL THEN 1 ELSE 0 END, es.created_at, es.id
      LIMIT 1),
    pg_temp.site_scoping_pick(p_skript_id, p_student_id)
  )
$$;

-- user_data: item_id is a page id, a front page id, or a skript id (skript-
-- scoped python imports). Site front pages map straight to their site.
UPDATE user_data ud SET site_id = fp.site_id
  FROM front_pages fp
 WHERE fp.id = ud.item_id AND fp.site_id IS NOT NULL AND ud.site_id = '';

UPDATE user_data ud SET site_id = COALESCE(pg_temp.site_scoping_pick(p."skriptId", ud.user_id), '')
  FROM pages p
 WHERE p.id = ud.item_id AND ud.site_id = '';

UPDATE user_data ud SET site_id = COALESCE(pg_temp.site_scoping_pick(fp.skript_id, ud.user_id), '')
  FROM front_pages fp
 WHERE fp.id = ud.item_id AND fp.skript_id IS NOT NULL AND ud.site_id = '';

UPDATE user_data ud SET site_id = COALESCE(pg_temp.site_scoping_pick(sk.id, ud.user_id), '')
  FROM skripts sk
 WHERE sk.id = ud.item_id AND ud.site_id = '';

UPDATE user_data_checkpoints t SET site_id = COALESCE(pg_temp.site_scoping_pick(p."skriptId", t.user_id), '')
  FROM pages p WHERE p.id = t.page_id AND t.site_id = '';

-- Exam assignments: the class teacher is the subject (their own site wins).
UPDATE exam_states t SET site_id = COALESCE(pg_temp.site_scoping_pick(p."skriptId", c.teacher_id), '')
  FROM pages p, classes c WHERE p.id = t.page_id AND c.id = t.class_id AND t.site_id = '';

UPDATE exam_submissions t SET site_id = COALESCE(pg_temp.site_scoping_pick_exam(p.id, p."skriptId", t.student_id), '')
  FROM pages p WHERE p.id = t.page_id AND t.site_id = '';

UPDATE component_scores t SET site_id = COALESCE(pg_temp.site_scoping_pick_exam(p.id, p."skriptId", t.student_id), '')
  FROM pages p WHERE p.id = t.page_id AND t.site_id = '';

UPDATE exam_audit_logs t SET site_id = COALESCE(pg_temp.site_scoping_pick_exam(p.id, p."skriptId", t.student_id), '')
  FROM pages p WHERE p.id = t.page_id AND t.site_id = '';

UPDATE exam_sessions t SET site_id = COALESCE(pg_temp.site_scoping_pick_exam(p.id, p."skriptId", t.user_id), '')
  FROM pages p WHERE p.id = t.page_id AND t.site_id = '';

DROP FUNCTION pg_temp.site_scoping_pick_exam(text, text, text);
DROP FUNCTION pg_temp.site_scoping_pick(text, text);
DROP TABLE _skript_sites;

COMMIT;
