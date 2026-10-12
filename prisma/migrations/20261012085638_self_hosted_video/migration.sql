-- AlterTable
ALTER TABLE "videos" ADD COLUMN     "encode_job_id" TEXT;

-- CreateTable
CREATE TABLE "video_encode_jobs" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "source" TEXT NOT NULL,
    "output_prefix" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "progress" DOUBLE PRECISION,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_encode_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "video_encode_jobs_status_available_at_idx" ON "video_encode_jobs"("status", "available_at");

-- CreateIndex
CREATE INDEX "videos_encode_job_id_idx" ON "videos"("encode_job_id");

-- AddForeignKey
ALTER TABLE "videos" ADD CONSTRAINT "videos_encode_job_id_fkey" FOREIGN KEY ("encode_job_id") REFERENCES "video_encode_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
