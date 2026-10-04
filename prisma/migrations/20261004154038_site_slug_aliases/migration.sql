-- CreateTable
CREATE TABLE "site_slug_aliases" (
    "slug" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_slug_aliases_pkey" PRIMARY KEY ("slug")
);

-- CreateIndex
CREATE INDEX "site_slug_aliases_site_id_idx" ON "site_slug_aliases"("site_id");

-- AddForeignKey
ALTER TABLE "site_slug_aliases" ADD CONSTRAINT "site_slug_aliases_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
