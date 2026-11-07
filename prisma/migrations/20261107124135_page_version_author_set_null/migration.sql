-- DropForeignKey
ALTER TABLE "front_page_versions" DROP CONSTRAINT "front_page_versions_author_id_fkey";

-- DropForeignKey
ALTER TABLE "page_versions" DROP CONSTRAINT "page_versions_authorId_fkey";

-- AlterTable
ALTER TABLE "front_page_versions" ALTER COLUMN "author_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "page_versions" ALTER COLUMN "authorId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "front_page_versions" ADD CONSTRAINT "front_page_versions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
