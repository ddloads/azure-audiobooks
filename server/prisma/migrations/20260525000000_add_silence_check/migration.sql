-- AlterTable: add silence check fields to IndexedAudioFile
ALTER TABLE "IndexedAudioFile" ADD COLUMN "isSilent" BOOLEAN,
ADD COLUMN "maxVolumeDb" DOUBLE PRECISION,
ADD COLUMN "silenceCheckedAt" TIMESTAMP(3);

-- CreateTable: SilenceCheckJob
CREATE TABLE "SilenceCheckJob" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "trigger" TEXT,
    "totalFiles" INTEGER,
    "checkedFiles" INTEGER NOT NULL DEFAULT 0,
    "silentFiles" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SilenceCheckJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SilenceCheckJob_libraryId_status_idx" ON "SilenceCheckJob"("libraryId", "status");

-- CreateIndex
CREATE INDEX "SilenceCheckJob_status_createdAt_idx" ON "SilenceCheckJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "IndexedAudioFile_isSilent_idx" ON "IndexedAudioFile"("isSilent");

-- AddForeignKey
ALTER TABLE "SilenceCheckJob" ADD CONSTRAINT "SilenceCheckJob_libraryId_fkey" FOREIGN KEY ("libraryId") REFERENCES "Library"("id") ON DELETE SET NULL ON UPDATE CASCADE;
