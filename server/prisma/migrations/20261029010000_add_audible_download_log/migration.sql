-- CreateTable
CREATE TABLE "AudibleDownloadLog" (
    "id" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "asin" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "coverUrl" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "libraryId" TEXT,
    "folderPath" TEXT,
    "bookId" TEXT,
    "sizeBytes" BIGINT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudibleDownloadLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AudibleDownloadLog_finishedAt_idx" ON "AudibleDownloadLog"("finishedAt");

-- CreateIndex
CREATE INDEX "AudibleDownloadLog_asin_idx" ON "AudibleDownloadLog"("asin");

-- Seed the history with downloads made before it existed
INSERT INTO "AudibleDownloadLog" ("id", "profile", "asin", "title", "author", "coverUrl", "status", "error", "folderPath", "finishedAt")
SELECT md5(random()::text || "id"), "profile", "asin", "title", "author", "coverUrl", "downloadStatus", "downloadError", "downloadedPath", COALESCE("downloadedAt", "updatedAt")
FROM "AudibleLibraryItem"
WHERE "downloadStatus" IN ('done', 'failed');
