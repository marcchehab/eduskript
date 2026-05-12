/*
  Warnings:

  - A unique constraint covering the columns `[implicit_page_id]` on the table `classes` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "classes" ADD COLUMN     "implicit_page_id" TEXT,
ADD COLUMN     "is_implicit" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "teacher_id" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "classes_implicit_page_id_key" ON "classes"("implicit_page_id");

-- CreateIndex
CREATE INDEX "classes_is_implicit_idx" ON "classes"("is_implicit");

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_implicit_page_id_fkey" FOREIGN KEY ("implicit_page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
