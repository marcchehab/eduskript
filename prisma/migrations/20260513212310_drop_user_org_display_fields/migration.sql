/*
  Warnings:

  - You are about to drop the column `ai_system_prompt` on the `organizations` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `organizations` table. All the data in the column will be lost.
  - You are about to drop the column `icon_url` on the `organizations` table. All the data in the column will be lost.
  - You are about to drop the column `page_language` on the `organizations` table. All the data in the column will be lost.
  - You are about to drop the column `page_tagline` on the `organizations` table. All the data in the column will be lost.
  - You are about to drop the column `show_icon` on the `organizations` table. All the data in the column will be lost.
  - You are about to drop the column `sidebar_behavior` on the `organizations` table. All the data in the column will be lost.
  - You are about to drop the column `aiSystemPrompt` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `pageDescription` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `pageIcon` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `pageName` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `page_language` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `page_tagline` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `sidebarBehavior` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `typographyPreference` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "organizations" DROP COLUMN "ai_system_prompt",
DROP COLUMN "description",
DROP COLUMN "icon_url",
DROP COLUMN "page_language",
DROP COLUMN "page_tagline",
DROP COLUMN "show_icon",
DROP COLUMN "sidebar_behavior";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "aiSystemPrompt",
DROP COLUMN "pageDescription",
DROP COLUMN "pageIcon",
DROP COLUMN "pageName",
DROP COLUMN "page_language",
DROP COLUMN "page_tagline",
DROP COLUMN "sidebarBehavior",
DROP COLUMN "typographyPreference";
