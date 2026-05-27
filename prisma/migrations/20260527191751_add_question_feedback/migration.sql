-- AlterTable
ALTER TABLE "exam_question_grades" ADD COLUMN     "feedback" TEXT,
ALTER COLUMN "awarded_points" DROP NOT NULL;
