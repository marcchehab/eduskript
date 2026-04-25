-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "page_language" TEXT,
ADD COLUMN     "page_tagline" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "page_language" TEXT,
ADD COLUMN     "page_tagline" TEXT;
