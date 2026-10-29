-- CreateTable
CREATE TABLE "AudibleLibraryItem" (
    "id" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "asin" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "author" TEXT,
    "narrator" TEXT,
    "seriesName" TEXT,
    "seriesSequence" TEXT,
    "durationSeconds" INTEGER,
    "coverUrl" TEXT,
    "releaseDate" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "ignoredAt" TIMESTAMP(3),
    "downloadStatus" TEXT,
    "downloadError" TEXT,
    "downloadedPath" TEXT,
    "downloadedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AudibleLibraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AudibleLibraryItem_profile_asin_key" ON "AudibleLibraryItem"("profile", "asin");

-- CreateIndex
CREATE INDEX "AudibleLibraryItem_profile_ignoredAt_idx" ON "AudibleLibraryItem"("profile", "ignoredAt");

-- CreateIndex
CREATE INDEX "AudibleLibraryItem_downloadStatus_idx" ON "AudibleLibraryItem"("downloadStatus");
