-- AlterTable
ALTER TABLE "classes" ADD COLUMN     "archived_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "exam_records" (
    "id" TEXT NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL DEFAULT '',
    "class_id" TEXT,
    "class_name" TEXT,
    "page_title" TEXT NOT NULL,
    "student_name" TEXT,
    "student_pseudonym" TEXT,
    "student_email" TEXT,
    "submitted_at" TIMESTAMP(3),
    "returned_at" TIMESTAMP(3),
    "score" DOUBLE PRECISION,
    "max_score" DOUBLE PRECISION,
    "grade" DOUBLE PRECISION,
    "payload" JSONB NOT NULL,
    "retain_until" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exam_records_class_id_idx" ON "exam_records"("class_id");

-- CreateIndex
CREATE INDEX "exam_records_teacher_id_idx" ON "exam_records"("teacher_id");

-- CreateIndex
CREATE INDEX "exam_records_retain_until_idx" ON "exam_records"("retain_until");

-- CreateIndex
CREATE UNIQUE INDEX "exam_records_page_id_student_id_site_id_key" ON "exam_records"("page_id", "student_id", "site_id");
