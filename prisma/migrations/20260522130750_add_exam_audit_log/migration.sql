-- CreateTable
CREATE TABLE "exam_audit_logs" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exam_audit_logs_page_id_student_id_occurred_at_idx" ON "exam_audit_logs"("page_id", "student_id", "occurred_at");

-- CreateIndex
CREATE INDEX "exam_audit_logs_page_id_idx" ON "exam_audit_logs"("page_id");

-- AddForeignKey
ALTER TABLE "exam_audit_logs" ADD CONSTRAINT "exam_audit_logs_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_audit_logs" ADD CONSTRAINT "exam_audit_logs_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
