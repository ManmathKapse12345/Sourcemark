-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CREATOR', 'REVIEWER', 'APPROVER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ContentState" AS ENUM ('DRAFT', 'CHECKING', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TransitionAction" AS ENUM ('SUBMIT', 'RESOLVE', 'REQUEST_CHANGES', 'APPROVE', 'REJECT', 'REVISE');

-- CreateEnum
CREATE TYPE "GuidelineStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RuleType" AS ENUM ('banned_term', 'terminology', 'all_caps', 'punctuation', 'long_sentence', 'required_disclosure');

-- CreateEnum
CREATE TYPE "FactKind" AS ENUM ('money', 'quantity', 'name', 'date', 'claim');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "FindingKind" AS ENUM ('violation', 'needs_human_check');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('OPEN', 'DISPUTED', 'CLOSED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ResponseAction" AS ENUM ('ACCEPT', 'EDIT', 'DISPUTE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roles" "Role"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgCounter" (
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrgCounter_pkey" PRIMARY KEY ("orgId","kind")
);

-- CreateTable
CREATE TABLE "Guideline" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Guideline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuidelineVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "guidelineId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "GuidelineStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceFileName" TEXT,
    "rawText" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "GuidelineVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clause" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "heading" TEXT,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "embedding" vector(768),
    "embeddingModel" TEXT,

    CONSTRAINT "Clause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "RuleType" NOT NULL,
    "severity" "Severity" NOT NULL,
    "clauseCode" TEXT,
    "message" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fact" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "aliases" TEXT[],
    "attribute" TEXT NOT NULL,
    "kind" "FactKind" NOT NULL,
    "value" TEXT NOT NULL,
    "unit" TEXT,
    "validFrom" DATE NOT NULL,
    "validUntil" DATE,
    "source" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT,
    "colors" TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "state" "ContentState" NOT NULL DEFAULT 'DRAFT',
    "aiChecks" BOOLEAN NOT NULL DEFAULT true,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "sourceFileName" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "aiStatus" TEXT,
    "aiError" TEXT,
    "model" TEXT,
    "stats" JSONB,
    "error" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "kind" "FindingKind" NOT NULL,
    "category" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "origins" TEXT[],
    "spanStart" INTEGER,
    "spanEnd" INTEGER,
    "quote" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceCode" TEXT,
    "sourceClauseCode" TEXT,
    "sourceText" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "fixStart" INTEGER,
    "fixEnd" INTEGER,
    "fixReplacement" TEXT,
    "status" "FindingStatus" NOT NULL DEFAULT 'OPEN',
    "closedInVersionId" TEXT,
    "carriedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rewrite" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "start" INTEGER NOT NULL,
    "end" INTEGER NOT NULL,
    "original" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "fingerprints" TEXT[],

    CONSTRAINT "Rewrite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FindingResponse" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "action" "ResponseAction" NOT NULL,
    "reason" TEXT,
    "editedText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FindingResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "versionId" TEXT,
    "findingId" TEXT,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "action" "TransitionAction" NOT NULL,
    "fromState" "ContentState" NOT NULL,
    "toState" "ContentState" NOT NULL,
    "actorId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Member_orgId_userId_key" ON "Member"("orgId", "userId");

-- CreateIndex
CREATE INDEX "Guideline_orgId_idx" ON "Guideline"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Guideline_orgId_prefix_key" ON "Guideline"("orgId", "prefix");

-- CreateIndex
CREATE INDEX "GuidelineVersion_orgId_status_idx" ON "GuidelineVersion"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GuidelineVersion_guidelineId_number_key" ON "GuidelineVersion"("guidelineId", "number");

-- CreateIndex
CREATE INDEX "Clause_orgId_idx" ON "Clause"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Clause_versionId_code_key" ON "Clause"("versionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Rule_orgId_code_key" ON "Rule"("orgId", "code");

-- CreateIndex
CREATE INDEX "Fact_orgId_subject_attribute_idx" ON "Fact"("orgId", "subject", "attribute");

-- CreateIndex
CREATE UNIQUE INDEX "Fact_orgId_code_key" ON "Fact"("orgId", "code");

-- CreateIndex
CREATE INDEX "Asset_orgId_idx" ON "Asset"("orgId");

-- CreateIndex
CREATE INDEX "ContentItem_orgId_state_idx" ON "ContentItem"("orgId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ContentVersion_contentItemId_number_key" ON "ContentVersion"("contentItemId", "number");

-- CreateIndex
CREATE INDEX "AnalysisRun_contentItemId_createdAt_idx" ON "AnalysisRun"("contentItemId", "createdAt");

-- CreateIndex
CREATE INDEX "Finding_contentItemId_status_idx" ON "Finding"("contentItemId", "status");

-- CreateIndex
CREATE INDEX "Finding_orgId_sourceCode_idx" ON "Finding"("orgId", "sourceCode");

-- CreateIndex
CREATE UNIQUE INDEX "Rewrite_runId_key_key" ON "Rewrite"("runId", "key");

-- CreateIndex
CREATE INDEX "AuditLog_orgId_entityType_entityId_idx" ON "AuditLog"("orgId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_orgId_createdAt_idx" ON "AuditLog"("orgId", "createdAt");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuidelineVersion" ADD CONSTRAINT "GuidelineVersion_guidelineId_fkey" FOREIGN KEY ("guidelineId") REFERENCES "Guideline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clause" ADD CONSTRAINT "Clause_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "GuidelineVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentVersion" ADD CONSTRAINT "ContentVersion_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_carriedFromId_fkey" FOREIGN KEY ("carriedFromId") REFERENCES "Finding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rewrite" ADD CONSTRAINT "Rewrite_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingResponse" ADD CONSTRAINT "FindingResponse_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalEvent" ADD CONSTRAINT "ApprovalEvent_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
