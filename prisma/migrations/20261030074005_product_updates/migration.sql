-- AlterTable
ALTER TABLE "users" ADD COLUMN     "product_updates" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "product_updates_consent_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "product_updates" (
    "id" TEXT NOT NULL,
    "from_addr" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body_html" TEXT,
    "body_text" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "recipient_count" INTEGER,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_updates_created_at_idx" ON "product_updates"("created_at");
