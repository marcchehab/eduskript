/*
  Warnings:

  - A unique constraint covering the columns `[site_id]` on the table `page_layouts` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "page_layouts" ADD COLUMN     "site_id" TEXT,
ALTER COLUMN "user_id" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "page_layouts_site_id_key" ON "page_layouts"("site_id");

-- AddForeignKey
ALTER TABLE "page_layouts" ADD CONSTRAINT "page_layouts_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
