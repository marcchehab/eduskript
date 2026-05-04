-- CreateTable
CREATE TABLE "user_data_checkpoints" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "component_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_data_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_data_checkpoints_user_id_idx" ON "user_data_checkpoints"("user_id");

-- CreateIndex
CREATE INDEX "user_data_checkpoints_page_id_idx" ON "user_data_checkpoints"("page_id");

-- CreateIndex
CREATE INDEX "user_data_checkpoints_user_id_page_id_component_id_created__idx" ON "user_data_checkpoints"("user_id", "page_id", "component_id", "created_at");

-- AddForeignKey
ALTER TABLE "user_data_checkpoints" ADD CONSTRAINT "user_data_checkpoints_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_data_checkpoints" ADD CONSTRAINT "user_data_checkpoints_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
