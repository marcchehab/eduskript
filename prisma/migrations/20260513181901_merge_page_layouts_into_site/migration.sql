/*
  Warnings:

  - You are about to drop the column `user_id` on the `page_layouts` table. All the data in the column will be lost.
  - You are about to drop the `org_page_layout_items` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `org_page_layouts` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `site_id` on table `page_layouts` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "org_page_layout_items" DROP CONSTRAINT "org_page_layout_items_org_page_layout_id_fkey";

-- DropForeignKey
ALTER TABLE "org_page_layouts" DROP CONSTRAINT "org_page_layouts_organization_id_fkey";

-- DropForeignKey
ALTER TABLE "page_layouts" DROP CONSTRAINT "page_layouts_user_id_fkey";

-- DropIndex
DROP INDEX "page_layouts_user_id_key";

-- AlterTable
ALTER TABLE "page_layouts" DROP COLUMN "user_id",
ALTER COLUMN "site_id" SET NOT NULL;

-- DropTable
DROP TABLE "org_page_layout_items";

-- DropTable
DROP TABLE "org_page_layouts";
