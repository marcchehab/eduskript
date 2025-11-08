-- DropIndex
DROP INDEX "files_hash_key";

-- AlterTable
ALTER TABLE "users" ADD COLUMN "sidebarBehavior" TEXT DEFAULT 'contextual';
