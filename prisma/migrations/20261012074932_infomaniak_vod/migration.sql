/*
  Warnings:

  - A unique constraint covering the columns `[vod_media_id]` on the table `videos` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "videos" ADD COLUMN     "vod_media_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "videos_vod_media_id_key" ON "videos"("vod_media_id");
