/*
  Warnings:

  - A unique constraint covering the columns `[nickname_class_id,nickname]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "classes" ADD COLUMN     "nickname_login" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "nickname" TEXT,
ADD COLUMN     "nickname_class_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_nickname_class_id_nickname_key" ON "users"("nickname_class_id", "nickname");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_nickname_class_id_fkey" FOREIGN KEY ("nickname_class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
