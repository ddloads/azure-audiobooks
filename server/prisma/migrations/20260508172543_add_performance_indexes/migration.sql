-- CreateIndex
CREATE INDEX "AudioFile_bookId_index_idx" ON "AudioFile"("bookId", "index");

-- CreateIndex
CREATE INDEX "Book_libraryId_idx" ON "Book"("libraryId");

-- CreateIndex
CREATE INDEX "Book_authorId_idx" ON "Book"("authorId");

-- CreateIndex
CREATE INDEX "Book_seriesId_idx" ON "Book"("seriesId");

-- CreateIndex
CREATE INDEX "Book_createdAt_idx" ON "Book"("createdAt");

-- CreateIndex
CREATE INDEX "Book_year_idx" ON "Book"("year");

-- CreateIndex
CREATE INDEX "Book_narrator_idx" ON "Book"("narrator");

-- CreateIndex
CREATE INDEX "Book_publisher_idx" ON "Book"("publisher");

-- CreateIndex
CREATE INDEX "Book_language_idx" ON "Book"("language");

-- CreateIndex
CREATE INDEX "Book_asin_idx" ON "Book"("asin");

-- CreateIndex
CREATE INDEX "Book_isbn_idx" ON "Book"("isbn");

-- CreateIndex
CREATE INDEX "Book_abridged_idx" ON "Book"("abridged");

-- CreateIndex
CREATE INDEX "Chapter_bookId_start_idx" ON "Chapter"("bookId", "start");

-- CreateIndex
CREATE INDEX "LibrarySource_libraryId_isEnabled_idx" ON "LibrarySource"("libraryId", "isEnabled");

-- CreateIndex
CREATE INDEX "LibrarySource_libraryId_isWritable_idx" ON "LibrarySource"("libraryId", "isWritable");

-- CreateIndex
CREATE INDEX "Progress_userId_isFinished_idx" ON "Progress"("userId", "isFinished");

-- CreateIndex
CREATE INDEX "Progress_bookId_idx" ON "Progress"("bookId");

-- CreateIndex
CREATE INDEX "Progress_lastUpdate_idx" ON "Progress"("lastUpdate");
