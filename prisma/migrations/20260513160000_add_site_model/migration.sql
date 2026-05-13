-- CreateTable
CREATE TABLE "sites" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "user_id" TEXT,
    "organization_id" TEXT,
    "page_name" TEXT,
    "page_description" TEXT,
    "page_icon" TEXT,
    "page_tagline" TEXT,
    "page_language" TEXT,
    "sidebar_behavior" TEXT NOT NULL DEFAULT 'full',
    "typography_preference" TEXT DEFAULT 'modern',
    "show_icon" BOOLEAN NOT NULL DEFAULT true,
    "ai_system_prompt" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sites_slug_key" ON "sites"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "sites_user_id_key" ON "sites"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sites_organization_id_key" ON "sites"("organization_id");

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
