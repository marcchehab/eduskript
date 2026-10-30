-- CreateTable
CREATE TABLE "product_update_subscribers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "lang" TEXT NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_update_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_update_subscribers_email_key" ON "product_update_subscribers"("email");
