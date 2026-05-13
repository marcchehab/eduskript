-- AlterTable
ALTER TABLE "collections" ADD COLUMN     "site_id" TEXT;

-- CreateIndex
CREATE INDEX "collections_site_id_idx" ON "collections"("site_id");

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
