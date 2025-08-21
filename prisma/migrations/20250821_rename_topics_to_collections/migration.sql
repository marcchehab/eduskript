-- Migration: Rename topics to collections
-- This migration renames the "topics" table and related structures to "collections"

-- Step 1: Create the new collections table based on topics
ALTER TABLE "topics" RENAME TO "collections";

-- Step 2: Rename topic_authors table to collection_authors
ALTER TABLE "topic_authors" RENAME TO "collection_authors";

-- Step 3: Rename the topicId column in collection_authors
ALTER TABLE "collection_authors" RENAME COLUMN "topicId" TO "collectionId";

-- Step 4: Rename the topicId column in chapters table
ALTER TABLE "chapters" RENAME COLUMN "topicId" TO "collectionId";

-- Step 5: Update User table to use collectionAuthors instead of topicAuthors
-- Note: No actual table changes needed - this is handled by Prisma's relation mapping

-- Step 6: Drop and recreate indexes with new names
DROP INDEX "topics_slug_key";
CREATE UNIQUE INDEX "collections_slug_key" ON "collections"("slug");

DROP INDEX "topic_authors_topicId_userId_key";
CREATE UNIQUE INDEX "collection_authors_collectionId_userId_key" ON "collection_authors"("collectionId", "userId");

DROP INDEX "chapters_topicId_slug_key";
CREATE UNIQUE INDEX "chapters_collectionId_slug_key" ON "chapters"("collectionId", "slug");

-- Step 7: Drop and recreate foreign key constraints with new names
ALTER TABLE "collection_authors" DROP CONSTRAINT "topic_authors_topicId_fkey";
ALTER TABLE "collection_authors" DROP CONSTRAINT "topic_authors_userId_fkey";
ALTER TABLE "chapters" DROP CONSTRAINT "chapters_topicId_fkey";

-- Recreate foreign key constraints
ALTER TABLE "collection_authors" ADD CONSTRAINT "collection_authors_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collection_authors" ADD CONSTRAINT "collection_authors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;