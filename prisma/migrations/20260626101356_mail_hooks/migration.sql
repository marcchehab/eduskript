-- CreateTable
CREATE TABLE "mail_hooks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'login-code',
    "parser_config" JSONB,
    "source_email" TEXT,
    "ttl_minutes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_hooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_messages" (
    "id" TEXT NOT NULL,
    "hook_id" TEXT NOT NULL,
    "from_addr" TEXT NOT NULL,
    "subject" TEXT,
    "body_text" TEXT,
    "body_html" TEXT,
    "attachments" JSONB,
    "extracted" JSONB,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mail_hooks_token_key" ON "mail_hooks"("token");

-- CreateIndex
CREATE INDEX "mail_hooks_user_id_idx" ON "mail_hooks"("user_id");

-- CreateIndex
CREATE INDEX "mail_messages_hook_id_expires_at_idx" ON "mail_messages"("hook_id", "expires_at");

-- CreateIndex
CREATE INDEX "mail_messages_hook_id_created_at_idx" ON "mail_messages"("hook_id", "created_at");

-- AddForeignKey
ALTER TABLE "mail_hooks" ADD CONSTRAINT "mail_hooks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_hook_id_fkey" FOREIGN KEY ("hook_id") REFERENCES "mail_hooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
