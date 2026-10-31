-- Read-only report on stored quiz syntax. Counts and page ids only, no student data.
--
-- Run on the production host (the transaction is read-only and rolls back):
--   ssh -i ~/.ssh/eduskript-prod eduskript-prod \
--     'sudo docker exec -i eduskript-db psql -U eduskript -d eduskript -q' \
--     < scripts/quiz-stored-syntax-report.sql
--
-- Fenced and inline code are removed first, so documentation examples do not
-- count. Regex scan of pages.content, no markdown parser: `~~~` fences are not
-- removed. Related: src/lib/question-ids.ts, scripts/add-question-ids.ts.

BEGIN READ ONLY;
\pset format unaligned
\pset fieldsep ' | '
\pset tuples_only on

\echo == metric | count | pages
WITH c AS (
  SELECT id, page_type, "isPublished" pub,
    regexp_replace(regexp_replace(content, '```.*?```', '', 'g'), '`[^`\n]*`', '', 'g') body
  FROM pages
), q AS (
  SELECT c.id, c.page_type, c.pub, m[1] tag, regexp_replace(m[1], '=\s*("[^"]*"|''[^'']*'')', '=X', 'g') stripped
  FROM c, regexp_matches(body, '(<question(?:\s[^>]*)?>)', 'g') m
), a AS (
  SELECT c.id, c.page_type, c.pub, m[1] tag, regexp_replace(m[1], '=\s*("[^"]*"|''[^'']*'')', '=X', 'g') stripped
  FROM c, regexp_matches(body, '(<answer(?:\s[^>]*)?>)', 'g') m
), b AS (
  SELECT c.id, m[1] blk FROM c, regexp_matches(body, '(<question(?:\s[^>]*)?>.*?</question>)', 'g') m
)
SELECT 'questions', count(*), count(DISTINCT id) FROM q
UNION ALL SELECT 'questions without id', count(*), count(DISTINCT id) FROM q WHERE stripped !~ '\sid\s*='
UNION ALL SELECT '  of which published', count(*), count(DISTINCT id) FROM q WHERE pub AND stripped !~ '\sid\s*='
UNION ALL SELECT '  of which on exam pages', count(*), count(DISTINCT id) FROM q WHERE page_type = 'exam' AND stripped !~ '\sid\s*='
UNION ALL SELECT 'type="multi" questions', count(*), count(DISTINCT id) FROM q WHERE tag ~ 'type=["'']multi["'']'
UNION ALL SELECT 'bare or empty correct answers', count(*), count(DISTINCT id) FROM a WHERE stripped ~ '\scorrect(\s|/?>)' OR tag ~ '\scorrect\s*=\s*(""|'''')'
UNION ALL SELECT '  of which on exam pages', count(*), count(DISTINCT id) FROM a WHERE page_type = 'exam' AND (stripped ~ '\scorrect(\s|/?>)' OR tag ~ '\scorrect\s*=\s*(""|'''')')
UNION ALL SELECT 'correct="correct" answers', count(*), count(DISTINCT id) FROM a WHERE tag ~ '\scorrect\s*=\s*["'']correct'
UNION ALL SELECT 'lowercase is= answers', count(*), count(DISTINCT id) FROM a WHERE tag ~ '\sis\s*='
UNION ALL SELECT 'text questions with <answer correct>', count(*), count(DISTINCT id) FROM b WHERE blk ~ '^<question[^>]*type=["'']text' AND blk ~ '<answer[^>]*\scorrect';

\echo == shared quiz- rows | rows | users | pages
SELECT 'user_data', count(*), count(DISTINCT user_id), count(DISTINCT item_id) FROM user_data WHERE adapter = 'quiz-'
UNION ALL SELECT 'user_data_checkpoints', count(*), count(DISTINCT user_id), count(DISTINCT page_id) FROM user_data_checkpoints WHERE component_id = 'quiz-'
UNION ALL SELECT 'component_scores', count(*), count(DISTINCT student_id), count(DISTINCT page_id) FROM component_scores WHERE component_id = 'quiz-';

\echo == exam pages with bare correct: page | questions | students with answers | check scores | override scores | submissions | currently returned
WITH c AS (
  SELECT id, regexp_replace(regexp_replace(content, '```.*?```', '', 'g'), '`[^`\n]*`', '', 'g') body
  FROM pages WHERE page_type = 'exam'
), blk AS (
  SELECT c.id page_id, m[1] blk FROM c, regexp_matches(body, '(<question(?:\s[^>]*)?>.*?</question>)', 'g') m
), hit AS (
  SELECT DISTINCT page_id, 'quiz-' || COALESCE(substring(blk FROM '^<question[^>]*\sid=["'']([^"'']+)'), '') component_id
  FROM blk, regexp_matches(blk, '(<answer(?:\s[^>]*)?>)', 'g') a
  WHERE regexp_replace(a[1], '=\s*("[^"]*"|''[^'']*'')', '=X', 'g') ~ '\scorrect(\s|/?>)'
     OR a[1] ~ '\scorrect\s*=\s*(""|'''')'
), latest AS (
  SELECT DISTINCT ON (page_id, student_id, site_id) page_id, student_id, event
  FROM exam_audit_logs WHERE event IN ('return', 'take_back', 'reopened')
  ORDER BY page_id, student_id, site_id, occurred_at DESC
)
SELECT p.page_id, p.questions,
  (SELECT count(DISTINCT u.user_id) FROM user_data u JOIN hit h ON h.component_id = u.adapter AND h.page_id = u.item_id WHERE u.item_id = p.page_id),
  (SELECT count(*) FROM component_scores s JOIN hit h ON h.component_id = s.component_id AND h.page_id = s.page_id WHERE s.page_id = p.page_id AND s.source = 'check'),
  (SELECT count(*) FROM component_scores s JOIN hit h ON h.component_id = s.component_id AND h.page_id = s.page_id WHERE s.page_id = p.page_id AND s.source = 'override'),
  (SELECT count(*) FROM exam_submissions e WHERE e.page_id = p.page_id),
  (SELECT count(*) FROM latest l WHERE l.page_id = p.page_id AND l.event = 'return')
FROM (SELECT page_id, count(*) questions FROM hit GROUP BY page_id) p
ORDER BY p.page_id;

ROLLBACK;
