-- DropIndex
DROP INDEX "sites_user_id_key";

-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "sites_user_id_idx" ON "sites"("user_id");
