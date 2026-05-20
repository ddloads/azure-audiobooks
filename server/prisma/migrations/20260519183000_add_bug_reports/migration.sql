CREATE TABLE "BugReport" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "comment" TEXT,
    "path" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BugReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BugReport_createdAt_idx" ON "BugReport"("createdAt");
CREATE INDEX "BugReport_type_idx" ON "BugReport"("type");
CREATE INDEX "BugReport_userId_idx" ON "BugReport"("userId");

ALTER TABLE "BugReport" ADD CONSTRAINT "BugReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
