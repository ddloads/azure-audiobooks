-- AlterTable: add silence-check fields to AudioFile (the table the scanner actually populates)
ALTER TABLE "AudioFile" ADD COLUMN "isSilent" BOOLEAN,
ADD COLUMN "maxVolumeDb" DOUBLE PRECISION,
ADD COLUMN "silenceCheckedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AudioFile_isSilent_idx" ON "AudioFile"("isSilent");
