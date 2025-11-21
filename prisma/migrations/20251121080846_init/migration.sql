-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "ext_expires_in" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verificationtokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "hashedPassword" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
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
    "gdprConsentAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "oauthProvider" TEXT,
    "oauthProviderId" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_domains" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "slug" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_authors" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL DEFAULT 'author',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_authors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_skripts" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT,
    "skriptId" TEXT NOT NULL,
    "userId" TEXT,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_skripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skripts" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "slug" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skript_authors" (
    "id" TEXT NOT NULL,
    "skriptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL DEFAULT 'author',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skript_authors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "skriptId" TEXT NOT NULL,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_authors" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL DEFAULT 'author',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_authors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_versions" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "changeLog" TEXT,
    "authorId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "is_directory" BOOLEAN NOT NULL DEFAULT false,
    "skript_id" TEXT NOT NULL,
    "hash" TEXT,
    "content_type" TEXT,
    "size" BIGINT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collaboration_requests" (
    "id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "receiver_id" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collaboration_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collaborations" (
    "id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "receiver_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collaborations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_layouts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "page_layouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_layout_items" (
    "id" TEXT NOT NULL,
    "page_layout_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_layout_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_progress" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "last_viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_submissions" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "content_data" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "grade" DOUBLE PRECISION,
    "feedback" TEXT,

    CONSTRAINT "student_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "teacher_id" TEXT NOT NULL,
    "invite_code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_memberships" (
    "id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "identity_consent" BOOLEAN NOT NULL DEFAULT false,
    "consented_at" TIMESTAMP(3),

    CONSTRAINT "class_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_authorized_students" (
    "id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "pseudonym" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pre_authorized_students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_reveal_requests" (
    "id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "teacher_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),

    CONSTRAINT "identity_reveal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "sessions"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "verificationtokens_token_key" ON "verificationtokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verificationtokens_identifier_token_key" ON "verificationtokens"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_subdomain_key" ON "users"("subdomain");

-- CreateIndex
CREATE UNIQUE INDEX "users_studentPseudonym_key" ON "users"("studentPseudonym");

-- CreateIndex
CREATE UNIQUE INDEX "users_oauthProvider_oauthProviderId_key" ON "users"("oauthProvider", "oauthProviderId");

-- CreateIndex
CREATE UNIQUE INDEX "custom_domains_domain_key" ON "custom_domains"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "collections_slug_key" ON "collections"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "collection_authors_collectionId_userId_key" ON "collection_authors"("collectionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "collection_skripts_collectionId_skriptId_key" ON "collection_skripts"("collectionId", "skriptId");

-- CreateIndex
CREATE UNIQUE INDEX "collection_skripts_skriptId_userId_key" ON "collection_skripts"("skriptId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "skripts_slug_key" ON "skripts"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "skript_authors_skriptId_userId_key" ON "skript_authors"("skriptId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "pages_skriptId_slug_key" ON "pages"("skriptId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "page_authors_pageId_userId_key" ON "page_authors"("pageId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "page_versions_pageId_version_key" ON "page_versions"("pageId", "version");

-- CreateIndex
CREATE INDEX "parent_skript_idx" ON "files"("parent_id", "skript_id");

-- CreateIndex
CREATE INDEX "hash_idx" ON "files"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "files_parent_id_name_skript_id_key" ON "files"("parent_id", "name", "skript_id");

-- CreateIndex
CREATE UNIQUE INDEX "collaboration_requests_requester_id_receiver_id_key" ON "collaboration_requests"("requester_id", "receiver_id");

-- CreateIndex
CREATE UNIQUE INDEX "collaborations_requester_id_receiver_id_key" ON "collaborations"("requester_id", "receiver_id");

-- CreateIndex
CREATE UNIQUE INDEX "page_layouts_user_id_key" ON "page_layouts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "page_layout_items_page_layout_id_content_id_type_key" ON "page_layout_items"("page_layout_id", "content_id", "type");

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

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_domains" ADD CONSTRAINT "custom_domains_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_authors" ADD CONSTRAINT "collection_authors_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_authors" ADD CONSTRAINT "collection_authors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_skripts" ADD CONSTRAINT "collection_skripts_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_skripts" ADD CONSTRAINT "collection_skripts_skriptId_fkey" FOREIGN KEY ("skriptId") REFERENCES "skripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_skripts" ADD CONSTRAINT "collection_skripts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skript_authors" ADD CONSTRAINT "skript_authors_skriptId_fkey" FOREIGN KEY ("skriptId") REFERENCES "skripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skript_authors" ADD CONSTRAINT "skript_authors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_skriptId_fkey" FOREIGN KEY ("skriptId") REFERENCES "skripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_authors" ADD CONSTRAINT "page_authors_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_authors" ADD CONSTRAINT "page_authors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_skript_id_fkey" FOREIGN KEY ("skript_id") REFERENCES "skripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaboration_requests" ADD CONSTRAINT "collaboration_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaboration_requests" ADD CONSTRAINT "collaboration_requests_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaborations" ADD CONSTRAINT "collaborations_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaborations" ADD CONSTRAINT "collaborations_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_layouts" ADD CONSTRAINT "page_layouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_layout_items" ADD CONSTRAINT "page_layout_items_page_layout_id_fkey" FOREIGN KEY ("page_layout_id") REFERENCES "page_layouts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_progress" ADD CONSTRAINT "student_progress_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_progress" ADD CONSTRAINT "student_progress_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_submissions" ADD CONSTRAINT "student_submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_submissions" ADD CONSTRAINT "student_submissions_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_memberships" ADD CONSTRAINT "class_memberships_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_memberships" ADD CONSTRAINT "class_memberships_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_authorized_students" ADD CONSTRAINT "pre_authorized_students_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_reveal_requests" ADD CONSTRAINT "identity_reveal_requests_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_reveal_requests" ADD CONSTRAINT "identity_reveal_requests_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity_reveal_requests" ADD CONSTRAINT "identity_reveal_requests_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
