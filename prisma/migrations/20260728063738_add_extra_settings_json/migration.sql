-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "extra_settings" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "extra_settings" JSONB NOT NULL DEFAULT '{}';
