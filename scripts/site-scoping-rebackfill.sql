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
-- Skripts placed on an org site AND an org admin's personal site: rows are
-- duplicated onto both sites (owner decision, bughunts #18/#20) — see the
-- duplication block below.
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

-- ---------------------------------------------------------------------------
-- Owner decisions (bughunt #18/#20): when a skript is placed on BOTH an org
-- site O and a personal site P owned by an owner/admin of O, the old code
-- could not tell which route data came through, so pre-migration rows are
-- DUPLICATED onto both sites (one row per site):
--   #18 public-layer rows (user_data target_type = 'page') — any placement;
--   #20 all student data (user_data, checkpoints, exam submissions/scores/
--       audit log) — when O's layout references a collection owned by P
--       (placement rule c).
-- Copies get deterministic ids (md5(original id || ':' || site)) and are
-- inserted only when the target site has no equivalent row, so re-running
-- is a no-op. Only rows created before the site_scoping migration finished
-- are duplicated (the re-backfill script must not copy live post-deploy data).
-- ---------------------------------------------------------------------------

-- Cutoff = when the site_scoping migration finished (re-backfill runs), else
-- now (inside the migration itself, or where _prisma_migrations doesn't
-- exist, e.g. a shadow database — referenced dynamically for that reason).
CREATE TEMP TABLE _dup_cutoff (at timestamptz);
DO $cutoff$
BEGIN
  IF to_regclass('_prisma_migrations') IS NOT NULL THEN
    EXECUTE $q$INSERT INTO _dup_cutoff
      SELECT COALESCE(
        (SELECT finished_at FROM _prisma_migrations
          WHERE migration_name LIKE '%\_site\_scoping' AND finished_at IS NOT NULL
          ORDER BY finished_at LIMIT 1),
        now())$q$;
  ELSE
    INSERT INTO _dup_cutoff VALUES (now());
  END IF;
END
$cutoff$;

-- (skript, O, P, rule_c)
CREATE TEMP TABLE _dup_pairs AS
  SELECT DISTINCT so.skript_id, so.site_id AS org_site, sp.site_id AS personal_site,
         EXISTS (
           SELECT 1 FROM page_layout_items pli
             JOIN page_layouts pl ON pl.id = pli.page_layout_id
             JOIN collections c ON c.id = pli.content_id
             JOIN collection_skripts cs ON cs."collectionId" = c.id
            WHERE pli.type = 'collection' AND pl.site_id = so.site_id
              AND c.site_id = sp.site_id AND cs."skriptId" = so.skript_id
         ) AS rule_c
    FROM _skript_sites so
    JOIN sites o ON o.id = so.site_id AND o.organization_id IS NOT NULL
    JOIN _skript_sites sp ON sp.skript_id = so.skript_id
    JOIN sites p ON p.id = sp.site_id AND p.user_id IS NOT NULL
   WHERE EXISTS (SELECT 1 FROM organization_members m
                  WHERE m.organization_id = o.organization_id AND m.user_id = p.user_id
                    AND m.role IN ('owner', 'admin'));

-- Both directions: (from_site, to_site) per skript.
CREATE TEMP TABLE _dup_moves AS
  SELECT skript_id, org_site AS from_site, personal_site AS to_site, rule_c FROM _dup_pairs
  UNION
  SELECT skript_id, personal_site, org_site, rule_c FROM _dup_pairs;

-- user_data → skript (pages, skript front pages, skript-id items).
CREATE TEMP TABLE _ud_skript AS
  SELECT ud.id, p."skriptId" AS skript_id FROM user_data ud JOIN pages p ON p.id = ud.item_id
  UNION ALL
  SELECT ud.id, fp.skript_id FROM user_data ud JOIN front_pages fp ON fp.id = ud.item_id WHERE fp.skript_id IS NOT NULL
  UNION ALL
  SELECT ud.id, sk.id FROM user_data ud JOIN skripts sk ON sk.id = ud.item_id;

INSERT INTO user_data (id, user_id, adapter, item_id, data, version, created_at, updated_at, target_type, target_id, site_id)
SELECT DISTINCT ON (ud.id, mv.to_site)
       md5(ud.id || ':' || mv.to_site), ud.user_id, ud.adapter, ud.item_id, ud.data, ud.version,
       ud.created_at, ud.updated_at, ud.target_type, ud.target_id, mv.to_site
  FROM user_data ud
  JOIN _ud_skript us ON us.id = ud.id
  JOIN _dup_moves mv ON mv.skript_id = us.skript_id AND mv.from_site = ud.site_id
 WHERE (ud.target_type = 'page' OR mv.rule_c)
   AND ud.created_at <= (SELECT at FROM _dup_cutoff)
   AND NOT EXISTS (
     SELECT 1 FROM user_data x
      WHERE x.user_id = ud.user_id AND x.site_id = mv.to_site AND x.adapter = ud.adapter
        AND x.item_id = ud.item_id
        AND x.target_type IS NOT DISTINCT FROM ud.target_type
        AND x.target_id IS NOT DISTINCT FROM ud.target_id
   );

INSERT INTO user_data_checkpoints (id, user_id, page_id, component_id, kind, payload, label, created_at, site_id)
SELECT DISTINCT ON (t.id, mv.to_site)
       md5(t.id || ':' || mv.to_site), t.user_id, t.page_id, t.component_id, t.kind, t.payload, t.label, t.created_at, mv.to_site
  FROM user_data_checkpoints t
  JOIN pages p ON p.id = t.page_id
  JOIN _dup_moves mv ON mv.skript_id = p."skriptId" AND mv.from_site = t.site_id AND mv.rule_c
 WHERE t.created_at <= (SELECT at FROM _dup_cutoff)
   AND NOT EXISTS (SELECT 1 FROM user_data_checkpoints x
                    WHERE x.site_id = mv.to_site AND x.user_id = t.user_id AND x.page_id = t.page_id
                      AND x.component_id = t.component_id AND x.kind = t.kind AND x.created_at = t.created_at);

INSERT INTO exam_submissions (id, page_id, student_id, submitted_at, score, scored_by, scored_at, returned_at, source, grade_snapshot, site_id)
SELECT DISTINCT ON (t.id, mv.to_site)
       md5(t.id || ':' || mv.to_site), t.page_id, t.student_id, t.submitted_at, t.score, t.scored_by, t.scored_at,
       t.returned_at, t.source, t.grade_snapshot, mv.to_site
  FROM exam_submissions t
  JOIN pages p ON p.id = t.page_id
  JOIN _dup_moves mv ON mv.skript_id = p."skriptId" AND mv.from_site = t.site_id AND mv.rule_c
 WHERE t.submitted_at <= (SELECT at FROM _dup_cutoff)
ON CONFLICT (page_id, student_id, site_id) DO NOTHING;

INSERT INTO component_scores (id, page_id, student_id, component_id, source, priority, earned, max, feedback, meta, created_by, created_at, updated_at, site_id)
SELECT DISTINCT ON (t.id, mv.to_site)
       md5(t.id || ':' || mv.to_site), t.page_id, t.student_id, t.component_id, t.source, t.priority, t.earned, t.max,
       t.feedback, t.meta, t.created_by, t.created_at, t.updated_at, mv.to_site
  FROM component_scores t
  JOIN pages p ON p.id = t.page_id
  JOIN _dup_moves mv ON mv.skript_id = p."skriptId" AND mv.from_site = t.site_id AND mv.rule_c
 WHERE t.created_at <= (SELECT at FROM _dup_cutoff)
ON CONFLICT (page_id, student_id, component_id, source, site_id) DO NOTHING;

INSERT INTO exam_audit_logs (id, page_id, student_id, event, occurred_at, created_by, payload, score, site_id)
SELECT DISTINCT ON (t.id, mv.to_site)
       md5(t.id || ':' || mv.to_site), t.page_id, t.student_id, t.event, t.occurred_at, t.created_by, t.payload, t.score, mv.to_site
  FROM exam_audit_logs t
  JOIN pages p ON p.id = t.page_id
  JOIN _dup_moves mv ON mv.skript_id = p."skriptId" AND mv.from_site = t.site_id AND mv.rule_c
 WHERE t.occurred_at <= (SELECT at FROM _dup_cutoff)
   AND NOT EXISTS (SELECT 1 FROM exam_audit_logs x
                    WHERE x.site_id = mv.to_site AND x.page_id = t.page_id AND x.student_id = t.student_id
                      AND x.event = t.event AND x.occurred_at = t.occurred_at);

DROP TABLE _ud_skript;
DROP TABLE _dup_moves;
DROP TABLE _dup_pairs;
DROP TABLE _dup_cutoff;

DROP FUNCTION pg_temp.site_scoping_pick_exam(text, text, text);
DROP FUNCTION pg_temp.site_scoping_pick(text, text);
DROP TABLE _skript_sites;

COMMIT;
