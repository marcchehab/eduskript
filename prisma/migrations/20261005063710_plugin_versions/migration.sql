-- CreateTable
CREATE TABLE "plugin_versions" (
    "id" TEXT NOT NULL,
    "pluginId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "entryHtml" TEXT NOT NULL,
    "changeLog" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plugin_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plugin_versions_pluginId_version_key" ON "plugin_versions"("pluginId", "version");

-- AddForeignKey
ALTER TABLE "plugin_versions" ADD CONSTRAINT "plugin_versions_pluginId_fkey" FOREIGN KEY ("pluginId") REFERENCES "plugins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
