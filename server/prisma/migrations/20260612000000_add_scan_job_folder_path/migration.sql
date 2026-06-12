-- AlterTable
ALTER TABLE "LibraryScanJob" ADD COLUMN "folderPath" TEXT;

-- CreateIndex
CREATE INDEX "LibraryScanJob_libraryId_trigger_status_idx" ON "LibraryScanJob"("libraryId", "trigger", "status");
