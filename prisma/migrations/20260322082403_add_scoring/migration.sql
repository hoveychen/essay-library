-- CreateTable
CREATE TABLE "ScoringResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "essayId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "brief" TEXT NOT NULL,
    "extra" TEXT,
    "model" TEXT NOT NULL,
    "promptSnapshot" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScoringResult_essayId_fkey" FOREIGN KEY ("essayId") REFERENCES "Essay" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AppConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ocrPrompt" TEXT NOT NULL,
    "matchPrompt" TEXT NOT NULL,
    "ocrModel" TEXT NOT NULL,
    "matchModel" TEXT NOT NULL,
    "scoringModel" TEXT NOT NULL DEFAULT 'moonshotai/kimi-k2',
    "scoringPromptThesis" TEXT NOT NULL DEFAULT '',
    "scoringPromptEvidence" TEXT NOT NULL DEFAULT '',
    "scoringPromptLogic" TEXT NOT NULL DEFAULT '',
    "scoringPromptLanguage" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AppConfig" ("id", "matchModel", "matchPrompt", "ocrModel", "ocrPrompt", "updatedAt") SELECT "id", "matchModel", "matchPrompt", "ocrModel", "ocrPrompt", "updatedAt" FROM "AppConfig";
DROP TABLE "AppConfig";
ALTER TABLE "new_AppConfig" RENAME TO "AppConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ScoringResult_essayId_dimension_key" ON "ScoringResult"("essayId", "dimension");
