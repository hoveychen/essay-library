-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "requirements" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Essay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "title" TEXT,
    "rawText" TEXT,
    "ocrStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "ocrPromptSnapshot" TEXT,
    "ocrError" TEXT,
    "matchStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "suggestedTopicId" TEXT,
    "suggestedReason" TEXT,
    "suggestedConfidence" REAL,
    "matchedTopicId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Essay_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Essay_suggestedTopicId_fkey" FOREIGN KEY ("suggestedTopicId") REFERENCES "Topic" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Essay_matchedTopicId_fkey" FOREIGN KEY ("matchedTopicId") REFERENCES "Topic" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EssayImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "essayId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "publicPath" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EssayImage_essayId_fkey" FOREIGN KEY ("essayId") REFERENCES "Essay" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "ocrPrompt" TEXT NOT NULL,
    "matchPrompt" TEXT NOT NULL,
    "ocrModel" TEXT NOT NULL,
    "matchModel" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
