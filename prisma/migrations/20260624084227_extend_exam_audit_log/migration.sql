-- AlterTable
ALTER TABLE "exam_audit_logs" ADD COLUMN     "created_by" TEXT,
ADD COLUMN     "payload" JSONB,
ADD COLUMN     "score" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "exam_audit_logs_page_id_occurred_at_idx" ON "exam_audit_logs"("page_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "exam_audit_logs" ADD CONSTRAINT "exam_audit_logs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
