/*
  Warnings:

  - A unique constraint covering the columns `[site_id]` on the table `front_pages` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "front_pages" ADD COLUMN     "site_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "front_pages_site_id_key" ON "front_pages"("site_id");

-- AddForeignKey
ALTER TABLE "front_pages" ADD CONSTRAINT "front_pages_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
