-- Persist duplicate groups that admins intentionally dismiss, such as alternate editions.
CREATE TABLE "IgnoredDuplicatePair" (
    "id" TEXT NOT NULL,
    "bookAId" TEXT NOT NULL,
    "bookBId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IgnoredDuplicatePair_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IgnoredDuplicatePair_bookAId_bookBId_key" ON "IgnoredDuplicatePair"("bookAId", "bookBId");
CREATE INDEX "IgnoredDuplicatePair_bookAId_idx" ON "IgnoredDuplicatePair"("bookAId");
CREATE INDEX "IgnoredDuplicatePair_bookBId_idx" ON "IgnoredDuplicatePair"("bookBId");

ALTER TABLE "IgnoredDuplicatePair" ADD CONSTRAINT "IgnoredDuplicatePair_bookAId_fkey"
  FOREIGN KEY ("bookAId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IgnoredDuplicatePair" ADD CONSTRAINT "IgnoredDuplicatePair_bookBId_fkey"
  FOREIGN KEY ("bookBId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
