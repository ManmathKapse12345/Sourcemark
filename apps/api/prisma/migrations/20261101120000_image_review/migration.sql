-- Image review: image posts, logo files, citable asset codes, finding boxes.

-- AlterTable
ALTER TABLE "AnalysisRun" ADD COLUMN     "notes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "ocrText" TEXT;

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "code" TEXT,
ADD COLUMN     "imageData" BYTEA,
ADD COLUMN     "imageMime" TEXT;

-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'text';

-- AlterTable
ALTER TABLE "ContentVersion" ADD COLUMN     "altText" TEXT,
ADD COLUMN     "imageData" BYTEA,
ADD COLUMN     "imageHeight" INTEGER,
ADD COLUMN     "imageMime" TEXT,
ADD COLUMN     "imageWidth" INTEGER;

-- AlterTable
ALTER TABLE "Finding" ADD COLUMN     "boxH" DOUBLE PRECISION,
ADD COLUMN     "boxW" DOUBLE PRECISION,
ADD COLUMN     "boxX" DOUBLE PRECISION,
ADD COLUMN     "boxY" DOUBLE PRECISION;

-- CreateIndex
CREATE UNIQUE INDEX "Asset_orgId_code_key" ON "Asset"("orgId", "code");

-- Existing assets get codes A-1, A-2, ... per organisation, in the order they were added.
UPDATE "Asset" a SET "code" = 'A-' || n.rn
FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "orgId" ORDER BY "createdAt", "id") AS rn FROM "Asset") n
WHERE a."id" = n."id";

INSERT INTO "OrgCounter" ("orgId", "kind", "value")
SELECT "orgId", 'asset', COUNT(*) FROM "Asset" GROUP BY "orgId"
ON CONFLICT ("orgId", "kind") DO UPDATE SET "value" = GREATEST("OrgCounter"."value", EXCLUDED."value");
