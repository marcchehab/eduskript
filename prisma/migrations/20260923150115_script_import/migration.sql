-- CreateTable
CREATE TABLE "script_imports" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "file_name" TEXT NOT NULL,
    "title" TEXT,
    "pages" JSONB,
    "warnings" JSONB,
    "error" TEXT,
    "ip_hash" TEXT NOT NULL,
    "pow_salt" TEXT NOT NULL,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "claimed_at" TIMESTAMP(3),
    "claimed_by_user_id" TEXT,
    "claimed_skript_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "script_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "script_import_assets" (
    "id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "script_import_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "script_imports_token_key" ON "script_imports"("token");

-- CreateIndex
CREATE UNIQUE INDEX "script_imports_pow_salt_key" ON "script_imports"("pow_salt");

-- CreateIndex
CREATE INDEX "script_imports_ip_hash_created_at_idx" ON "script_imports"("ip_hash", "created_at");

-- CreateIndex
CREATE INDEX "script_imports_created_at_idx" ON "script_imports"("created_at");

-- CreateIndex
CREATE INDEX "script_imports_expires_at_idx" ON "script_imports"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "script_import_assets_import_id_name_key" ON "script_import_assets"("import_id", "name");

-- AddForeignKey
ALTER TABLE "script_import_assets" ADD CONSTRAINT "script_import_assets_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "script_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
