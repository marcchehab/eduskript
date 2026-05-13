/*
  Warnings:

  - You are about to drop the column `userId` on the `collection_skripts` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `collections` table. All the data in the column will be lost.
  - You are about to drop the `collection_authors` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `collectionId` on table `collection_skripts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `site_id` on table `collections` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "collection_authors" DROP CONSTRAINT "collection_authors_collectionId_fkey";

-- DropForeignKey
ALTER TABLE "collection_authors" DROP CONSTRAINT "collection_authors_userId_fkey";

-- DropForeignKey
ALTER TABLE "collection_skripts" DROP CONSTRAINT "collection_skripts_userId_fkey";

-- DropIndex
DROP INDEX "collection_skripts_skriptId_userId_key";

-- AlterTable
ALTER TABLE "collection_skripts" DROP COLUMN "userId",
ALTER COLUMN "collectionId" SET NOT NULL;

-- AlterTable
ALTER TABLE "collections" DROP COLUMN "description",
ALTER COLUMN "site_id" SET NOT NULL;

-- DropTable
DROP TABLE "collection_authors";
