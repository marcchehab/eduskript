-- CreateTable
CREATE TABLE "exam_check_runs" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "component_id" TEXT NOT NULL,
    "earned" DOUBLE PRECISION NOT NULL,
    "max" DOUBLE PRECISION NOT NULL,
    "passed" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "ran_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ran_by" TEXT,

    CONSTRAINT "exam_check_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exam_check_runs_page_id_student_id_idx" ON "exam_check_runs"("page_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_check_runs_page_id_student_id_component_id_key" ON "exam_check_runs"("page_id", "student_id", "component_id");

-- AddForeignKey
ALTER TABLE "exam_check_runs" ADD CONSTRAINT "exam_check_runs_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_check_runs" ADD CONSTRAINT "exam_check_runs_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
