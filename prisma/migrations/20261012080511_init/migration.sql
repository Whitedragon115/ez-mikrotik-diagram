-- CreateTable
CREATE TABLE "SavedConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "identity" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "packet" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "SavedConfig_updatedAt_idx" ON "SavedConfig"("updatedAt");
