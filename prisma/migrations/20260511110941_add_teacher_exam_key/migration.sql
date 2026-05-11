-- CreateTable
CREATE TABLE "teacher_exam_keys" (
    "id" TEXT NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "key_id" TEXT NOT NULL,
    "public_key_jwk" JSONB NOT NULL,
    "private_key_jwk" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotated_at" TIMESTAMP(3),

    CONSTRAINT "teacher_exam_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teacher_exam_keys_key_id_key" ON "teacher_exam_keys"("key_id");

-- CreateIndex
CREATE INDEX "teacher_exam_keys_teacher_id_is_active_idx" ON "teacher_exam_keys"("teacher_id", "is_active");

-- AddForeignKey
ALTER TABLE "teacher_exam_keys" ADD CONSTRAINT "teacher_exam_keys_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
