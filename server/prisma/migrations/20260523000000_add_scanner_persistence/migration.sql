-- CreateTable
CREATE TABLE "LibraryScanJob" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "trigger" TEXT,
    "totalFolders" INTEGER,
    "scannedFolders" INTEGER NOT NULL DEFAULT 0,
    "totalFiles" INTEGER,
    "scannedFiles" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryScanJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexedAudioFile" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "bookId" TEXT,
    "lastScanJobId" TEXT,
    "path" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "modifiedAt" TIMESTAMP(3) NOT NULL,
    "checksum" TEXT,
    "durationSec" INTEGER,
    "codec" TEXT,
    "bitrate" INTEGER,
    "scanStatus" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "lastScannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexedAudioFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LibraryScanJob_libraryId_status_idx" ON "LibraryScanJob"("libraryId", "status");

-- CreateIndex
CREATE INDEX "LibraryScanJob_status_createdAt_idx" ON "LibraryScanJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "LibraryScanJob_createdAt_idx" ON "LibraryScanJob"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IndexedAudioFile_path_key" ON "IndexedAudioFile"("path");

-- CreateIndex
CREATE INDEX "IndexedAudioFile_libraryId_scanStatus_idx" ON "IndexedAudioFile"("libraryId", "scanStatus");

-- CreateIndex
CREATE INDEX "IndexedAudioFile_bookId_idx" ON "IndexedAudioFile"("bookId");

-- CreateIndex
CREATE INDEX "IndexedAudioFile_lastScanJobId_idx" ON "IndexedAudioFile"("lastScanJobId");

-- CreateIndex
CREATE INDEX "IndexedAudioFile_modifiedAt_idx" ON "IndexedAudioFile"("modifiedAt");

-- CreateIndex
CREATE INDEX "IndexedAudioFile_checksum_idx" ON "IndexedAudioFile"("checksum");

-- AddForeignKey
ALTER TABLE "LibraryScanJob" ADD CONSTRAINT "LibraryScanJob_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndexedAudioFile" ADD CONSTRAINT "IndexedAudioFile_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndexedAudioFile" ADD CONSTRAINT "IndexedAudioFile_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndexedAudioFile" ADD CONSTRAINT "IndexedAudioFile_lastScanJobId_fkey" FOREIGN KEY ("lastScanJobId") REFERENCES "LibraryScanJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
