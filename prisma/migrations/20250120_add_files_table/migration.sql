-- CreateTable
CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "is_directory" BOOLEAN NOT NULL DEFAULT false,
    "chapter_id" TEXT NOT NULL,
    "hash" TEXT,
    "content_type" TEXT,
    "size" BIGINT,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "files_parent_chapter_idx" ON "files"("parent_id", "chapter_id");

-- CreateIndex
CREATE INDEX "files_hash_idx" ON "files"("hash") WHERE "hash" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "files_hash_unique" ON "files"("hash") WHERE "hash" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "files_parent_name_chapter_unique" ON "files"("parent_id", "name", "chapter_id");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey  
ALTER TABLE "files" ADD CONSTRAINT "files_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add check constraints
-- Directories must have NULL hash, files must have non-NULL hash
ALTER TABLE "files" ADD CONSTRAINT "files_directory_hash_check" 
    CHECK ((is_directory = true AND hash IS NULL) OR (is_directory = false AND hash IS NOT NULL));

-- Directories must have NULL content_type and size
ALTER TABLE "files" ADD CONSTRAINT "files_directory_metadata_check"
    CHECK ((is_directory = true AND content_type IS NULL AND size IS NULL) OR (is_directory = false));