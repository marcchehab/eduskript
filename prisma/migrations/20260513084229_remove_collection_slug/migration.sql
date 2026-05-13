/*
  Warnings:

  - You are about to drop the column `slug` on the `collections` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "collections_slug_idx";

-- AlterTable
ALTER TABLE "collections" DROP COLUMN "slug";
