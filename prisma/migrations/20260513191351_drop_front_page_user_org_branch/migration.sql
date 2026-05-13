/*
  Warnings:

  - You are about to drop the column `organization_id` on the `front_pages` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `front_pages` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "front_pages" DROP CONSTRAINT "front_pages_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "front_pages" DROP CONSTRAINT "front_pages_user_id_fkey";

-- DropIndex
DROP INDEX "front_pages_organization_id_key";

-- DropIndex
DROP INDEX "front_pages_user_id_key";

-- AlterTable
ALTER TABLE "front_pages" DROP COLUMN "organization_id",
DROP COLUMN "user_id";
