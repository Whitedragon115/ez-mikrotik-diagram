/*
  Warnings:

  - Added the required column `ownerId` to the `SavedConfig` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "avatar" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SavedConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "identity" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "packet" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SavedConfig_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SavedConfig" ("config", "createdAt", "description", "id", "identity", "name", "packet", "updatedAt") SELECT "config", "createdAt", "description", "id", "identity", "name", "packet", "updatedAt" FROM "SavedConfig";
DROP TABLE "SavedConfig";
ALTER TABLE "new_SavedConfig" RENAME TO "SavedConfig";
CREATE INDEX "SavedConfig_ownerId_updatedAt_idx" ON "SavedConfig"("ownerId", "updatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
