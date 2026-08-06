-- CreateTable
CREATE TABLE "db_activity_hours" (
    "hour" TIMESTAMP(3) NOT NULL,
    "minutes" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "db_activity_hours_pkey" PRIMARY KEY ("hour")
);
