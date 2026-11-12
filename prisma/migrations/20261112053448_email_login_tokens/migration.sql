-- AlterTable
ALTER TABLE "pre_authorized_students" ADD COLUMN     "invited_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "email_login_tokens" (
    "id" TEXT NOT NULL,
    "pseudonym" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "class_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_login_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invite_opt_outs" (
    "pseudonym" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_opt_outs_pkey" PRIMARY KEY ("pseudonym")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_login_tokens_token_hash_key" ON "email_login_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_login_tokens_pseudonym_kind_idx" ON "email_login_tokens"("pseudonym", "kind");

-- CreateIndex
CREATE INDEX "email_login_tokens_expires_at_idx" ON "email_login_tokens"("expires_at");
