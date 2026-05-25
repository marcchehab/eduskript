-- AlterTable
ALTER TABLE "exam_submissions" ADD COLUMN     "returned_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "exam_grade_configs" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "max_points" DOUBLE PRECISION,
    "pass_percent" DOUBLE PRECISION NOT NULL DEFAULT 60,
    "pass_grade" DOUBLE PRECISION NOT NULL DEFAULT 4,
    "top_grade" DOUBLE PRECISION NOT NULL DEFAULT 6,
    "bottom_grade" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "rounding_step" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "formula" TEXT NOT NULL DEFAULT 'twoSegment',
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_grade_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_question_grades" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "component_id" TEXT NOT NULL,
    "awarded_points" DOUBLE PRECISION NOT NULL,
    "max_points" DOUBLE PRECISION,
    "graded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_question_grades_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exam_grade_configs_page_id_key" ON "exam_grade_configs"("page_id");

-- CreateIndex
CREATE INDEX "exam_question_grades_page_id_student_id_idx" ON "exam_question_grades"("page_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_question_grades_page_id_student_id_component_id_key" ON "exam_question_grades"("page_id", "student_id", "component_id");

-- AddForeignKey
ALTER TABLE "exam_grade_configs" ADD CONSTRAINT "exam_grade_configs_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_question_grades" ADD CONSTRAINT "exam_question_grades_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_question_grades" ADD CONSTRAINT "exam_question_grades_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
