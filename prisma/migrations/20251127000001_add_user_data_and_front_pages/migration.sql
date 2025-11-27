-- CreateTable
CREATE TABLE "user_data" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "front_pages" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT,
    "skript_id" TEXT,

    CONSTRAINT "front_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "front_page_versions" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "change_log" TEXT,
    "author_id" TEXT NOT NULL,
    "front_page_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "front_page_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_data_user_id_adapter_item_id_key" ON "user_data"("user_id", "adapter", "item_id");

-- CreateIndex
CREATE INDEX "user_data_user_id_idx" ON "user_data"("user_id");

-- CreateIndex
CREATE INDEX "user_data_user_id_adapter_idx" ON "user_data"("user_id", "adapter");

-- CreateIndex
CREATE INDEX "user_data_updated_at_idx" ON "user_data"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "front_pages_user_id_key" ON "front_pages"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "front_pages_skript_id_key" ON "front_pages"("skript_id");

-- CreateIndex
CREATE UNIQUE INDEX "front_page_versions_front_page_id_version_key" ON "front_page_versions"("front_page_id", "version");

-- AddForeignKey
ALTER TABLE "user_data" ADD CONSTRAINT "user_data_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "front_pages" ADD CONSTRAINT "front_pages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "front_pages" ADD CONSTRAINT "front_pages_skript_id_fkey" FOREIGN KEY ("skript_id") REFERENCES "skripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "front_page_versions" ADD CONSTRAINT "front_page_versions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "front_page_versions" ADD CONSTRAINT "front_page_versions_front_page_id_fkey" FOREIGN KEY ("front_page_id") REFERENCES "front_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
