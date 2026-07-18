-- AlterTable
ALTER TABLE "teacher_custom_domains" ADD COLUMN     "site_id" TEXT;

-- CreateIndex
CREATE INDEX "teacher_custom_domains_site_id_idx" ON "teacher_custom_domains"("site_id");

-- AddForeignKey
ALTER TABLE "teacher_custom_domains" ADD CONSTRAINT "teacher_custom_domains_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
