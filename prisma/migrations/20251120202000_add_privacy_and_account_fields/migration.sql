-- AlterTable
ALTER TABLE "accounts" ADD COLUMN "ext_expires_in" INTEGER;

-- CreateTable
CREATE TABLE "student_progress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "student_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "last_viewed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "student_progress_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "student_progress_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "student_submissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "student_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "content_data" TEXT NOT NULL,
    "submitted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "grade" REAL,
    "feedback" TEXT,
    CONSTRAINT "student_submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "student_submissions_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "classes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "teacher_id" TEXT NOT NULL,
    "invite_code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "classes_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "class_memberships" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "class_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "joined_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "identity_consent" BOOLEAN NOT NULL DEFAULT false,
    "consented_at" DATETIME,
    CONSTRAINT "class_memberships_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "class_memberships_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pre_authorized_students" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "class_id" TEXT NOT NULL,
    "pseudonym" TEXT NOT NULL,
    "added_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pre_authorized_students_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "identity_reveal_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "class_id" TEXT NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requested_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" DATETIME,
    CONSTRAINT "identity_reveal_requests_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "identity_reveal_requests_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "identity_reveal_requests_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" DATETIME,
    "image" TEXT,
    "hashedPassword" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "subdomain" TEXT,
    "webpageDescription" TEXT,
    "bio" TEXT,
    "title" TEXT,
    "themePreference" TEXT DEFAULT 'system',
    "sidebarBehavior" TEXT DEFAULT 'contextual',
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "requirePasswordReset" BOOLEAN NOT NULL DEFAULT false,
    "accountType" TEXT NOT NULL DEFAULT 'teacher',
    "studentPseudonym" TEXT,
    "gdprConsentAt" DATETIME,
    "lastSeenAt" DATETIME,
    "oauthProvider" TEXT,
    "oauthProviderId" TEXT
);
INSERT INTO "new_users" ("bio", "createdAt", "email", "emailVerified", "hashedPassword", "id", "image", "isAdmin", "name", "requirePasswordReset", "sidebarBehavior", "subdomain", "themePreference", "title", "updatedAt", "webpageDescription") SELECT "bio", "createdAt", "email", "emailVerified", "hashedPassword", "id", "image", "isAdmin", "name", "requirePasswordReset", "sidebarBehavior", "subdomain", "themePreference", "title", "updatedAt", "webpageDescription" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_subdomain_key" ON "users"("subdomain");
CREATE UNIQUE INDEX "users_studentPseudonym_key" ON "users"("studentPseudonym");
CREATE UNIQUE INDEX "users_oauthProvider_oauthProviderId_key" ON "users"("oauthProvider", "oauthProviderId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "student_progress_student_id_idx" ON "student_progress"("student_id");

-- CreateIndex
CREATE INDEX "student_progress_page_id_idx" ON "student_progress"("page_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_progress_student_id_page_id_key" ON "student_progress"("student_id", "page_id");

-- CreateIndex
CREATE INDEX "student_submissions_student_id_idx" ON "student_submissions"("student_id");

-- CreateIndex
CREATE INDEX "student_submissions_page_id_idx" ON "student_submissions"("page_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_submissions_student_id_page_id_key" ON "student_submissions"("student_id", "page_id");

-- CreateIndex
CREATE UNIQUE INDEX "classes_invite_code_key" ON "classes"("invite_code");

-- CreateIndex
CREATE INDEX "classes_teacher_id_idx" ON "classes"("teacher_id");

-- CreateIndex
CREATE INDEX "classes_invite_code_idx" ON "classes"("invite_code");

-- CreateIndex
CREATE INDEX "class_memberships_class_id_idx" ON "class_memberships"("class_id");

-- CreateIndex
CREATE INDEX "class_memberships_student_id_idx" ON "class_memberships"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_memberships_class_id_student_id_key" ON "class_memberships"("class_id", "student_id");

-- CreateIndex
CREATE INDEX "pre_authorized_students_pseudonym_idx" ON "pre_authorized_students"("pseudonym");

-- CreateIndex
CREATE INDEX "pre_authorized_students_class_id_idx" ON "pre_authorized_students"("class_id");

-- CreateIndex
CREATE UNIQUE INDEX "pre_authorized_students_class_id_pseudonym_key" ON "pre_authorized_students"("class_id", "pseudonym");

-- CreateIndex
CREATE INDEX "identity_reveal_requests_student_id_status_idx" ON "identity_reveal_requests"("student_id", "status");

-- CreateIndex
CREATE INDEX "identity_reveal_requests_class_id_idx" ON "identity_reveal_requests"("class_id");

-- CreateIndex
CREATE INDEX "identity_reveal_requests_teacher_id_idx" ON "identity_reveal_requests"("teacher_id");

-- CreateIndex
CREATE UNIQUE INDEX "identity_reveal_requests_class_id_student_id_email_key" ON "identity_reveal_requests"("class_id", "student_id", "email");
