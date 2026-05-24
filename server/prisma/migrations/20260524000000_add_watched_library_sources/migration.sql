ALTER TABLE "LibrarySource" ADD COLUMN "isWatched" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "LibrarySource_libraryId_isWatched_idx" ON "LibrarySource"("libraryId", "isWatched");
