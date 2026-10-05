-- Exact row count of every table in schema public, one "table|count" line
-- each, sorted. Run on both sides of a migration and diff the output
-- (MIGRATION-VPS.md §7). O(total rows) — fine at ~130 MB.
SELECT format('SELECT %L || ''|'' || count(*) FROM public.%I', table_name, table_name)
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name
\gexec
SELECT '_last_migration|' || migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1;
