/*
  Warnings:

  - You are about to drop the column `slug` on the `organizations` table. All the data in the column will be lost.
  - You are about to drop the column `pageSlug` on the `users` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "organizations_slug_key";

-- DropIndex
DROP INDEX "users_pageSlug_key";

-- AlterTable
ALTER TABLE "organizations" DROP COLUMN "slug";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "pageSlug";
