-- AlterTable
ALTER TABLE "pages" ADD COLUMN     "forked_at" TIMESTAMP(3),
ADD COLUMN     "forked_from_author_id" TEXT,
ADD COLUMN     "forked_from_page_id" TEXT;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_forked_from_page_id_fkey" FOREIGN KEY ("forked_from_page_id") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_forked_from_author_id_fkey" FOREIGN KEY ("forked_from_author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
