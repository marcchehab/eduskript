-- Rename (hand-edited from Prisma's drop+add so existing return-provenance is
-- preserved on prod). graded_by/graded_at -> scored_by/scored_at. Vocab rule:
-- score/scoring = points; grade = the 1-6 Note. See src/lib/scoring.
-- DropForeignKey
ALTER TABLE "exam_submissions" DROP CONSTRAINT "exam_submissions_graded_by_fkey";

-- AlterTable (rename in place, keep data)
ALTER TABLE "exam_submissions" RENAME COLUMN "graded_at" TO "scored_at";
ALTER TABLE "exam_submissions" RENAME COLUMN "graded_by" TO "scored_by";

-- CreateTable
CREATE TABLE "component_scores" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "component_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "earned" DOUBLE PRECISION,
    "max" DOUBLE PRECISION,
    "feedback" TEXT,
    "meta" JSONB,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "component_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoring_rubrics" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "component_id" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "max_points" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'ai',
    "model" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scoring_rubrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "component_scores_page_id_student_id_idx" ON "component_scores"("page_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "component_scores_page_id_student_id_component_id_source_key" ON "component_scores"("page_id", "student_id", "component_id", "source");

-- CreateIndex
CREATE UNIQUE INDEX "scoring_rubrics_page_id_component_id_key" ON "scoring_rubrics"("page_id", "component_id");

-- AddForeignKey
ALTER TABLE "exam_submissions" ADD CONSTRAINT "exam_submissions_scored_by_fkey" FOREIGN KEY ("scored_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "component_scores" ADD CONSTRAINT "component_scores_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "component_scores" ADD CONSTRAINT "component_scores_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_rubrics" ADD CONSTRAINT "scoring_rubrics_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
