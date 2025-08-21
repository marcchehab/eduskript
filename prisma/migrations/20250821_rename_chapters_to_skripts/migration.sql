-- Migration: Rename chapters to skripts
-- This migration renames the "chapters" table and related structures to "skripts"

-- Step 1: Rename chapters table to skripts
ALTER TABLE "chapters" RENAME TO "skripts";

-- Step 2: Rename chapter_authors table to skript_authors
ALTER TABLE "chapter_authors" RENAME TO "skript_authors";

-- Step 3: Rename the chapterId column in skript_authors
ALTER TABLE "skript_authors" RENAME COLUMN "chapterId" TO "skriptId";

-- Step 4: Rename the chapterId column in pages table
ALTER TABLE "pages" RENAME COLUMN "chapterId" TO "skriptId";

-- Step 5: Rename the chapter_id column in files table
ALTER TABLE "files" RENAME COLUMN "chapter_id" TO "skript_id";

-- Step 6: Drop and recreate indexes with new names
DROP INDEX "chapters_collectionId_slug_key";
CREATE UNIQUE INDEX "skripts_collectionId_slug_key" ON "skripts"("collectionId", "slug");

DROP INDEX "chapter_authors_chapterId_userId_key";
CREATE UNIQUE INDEX "skript_authors_skriptId_userId_key" ON "skript_authors"("skriptId", "userId");

DROP INDEX "pages_chapterId_slug_key";
CREATE UNIQUE INDEX "pages_skriptId_slug_key" ON "pages"("skriptId", "slug");

DROP INDEX "parent_chapter_idx";
CREATE INDEX "parent_skript_idx" ON "files"("parent_id", "skript_id");

DROP INDEX "unique_file_name_per_parent_chapter";
CREATE UNIQUE INDEX "unique_file_name_per_parent_skript" ON "files"("parent_id", "name", "skript_id");

-- Step 7: Drop and recreate foreign key constraints with new names
ALTER TABLE "skript_authors" DROP CONSTRAINT "chapter_authors_chapterId_fkey";
ALTER TABLE "skript_authors" DROP CONSTRAINT "chapter_authors_userId_fkey";
ALTER TABLE "pages" DROP CONSTRAINT "pages_chapterId_fkey";
ALTER TABLE "files" DROP CONSTRAINT "files_chapter_id_fkey";

-- Recreate foreign key constraints
ALTER TABLE "skript_authors" ADD CONSTRAINT "skript_authors_skriptId_fkey" FOREIGN KEY ("skriptId") REFERENCES "skripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "skript_authors" ADD CONSTRAINT "skript_authors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pages" ADD CONSTRAINT "pages_skriptId_fkey" FOREIGN KEY ("skriptId") REFERENCES "skripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "files" ADD CONSTRAINT "files_skript_id_fkey" FOREIGN KEY ("skript_id") REFERENCES "skripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;