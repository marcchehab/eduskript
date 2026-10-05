-- CreateTable
CREATE TABLE "plugin_templates" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "svg" TEXT NOT NULL,
    "meta" JSONB NOT NULL,
    "source_url" TEXT,
    "created_by_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plugin_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plugin_templates_slug_key" ON "plugin_templates"("slug");

-- AddForeignKey
ALTER TABLE "plugin_templates" ADD CONSTRAINT "plugin_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
