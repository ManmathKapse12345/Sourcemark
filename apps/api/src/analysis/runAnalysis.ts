import type { AnalysisRun, Prisma } from "@prisma/client";
import { Channel, type AnalyzeResponse, type ImageAnalyzeResponse } from "@sourcemark/contract";
import { audit } from "../audit.js";
import { prisma } from "../db.js";
import { HttpError } from "../http/errors.js";
import { logger } from "../logger.js";
import { loadBrandKit, loadImageAssets } from "./brandKit.js";
import type { AnalysisClient } from "./client.js";

interface RunInput {
  orgId: string;
  contentItemId: string;
  versionId: string;
  actorId: string;
}

// Runs the analysis service on one content version and stores the result.
//
// Findings are matched across versions by fingerprint (source + flagged text):
//  - a previous finding that is not reproduced is CLOSED: the new version fixed it;
//  - a reproduced finding is SUPERSEDED by the new one, which inherits a dispute if there was one.
// So a finding closes only when a new version passes, never just because a fix was accepted.
export async function runAnalysis(client: AnalysisClient, input: RunInput): Promise<AnalysisRun> {
  const { orgId, contentItemId, versionId, actorId } = input;
  const [item, version] = await Promise.all([
    prisma.contentItem.findUniqueOrThrow({ where: { id: contentItemId } }),
    prisma.contentVersion.findUniqueOrThrow({ where: { id: versionId } }),
  ]);

  const run = await prisma.analysisRun.create({ data: { orgId, contentItemId, versionId } });

  // Image posts also return the text read from the image (findings' spans point into it) and notes.
  let result: AnalyzeResponse & Partial<Pick<ImageAnalyzeResponse, "ocr_text" | "image" | "notes">>;
  try {
    const brandKit = await loadBrandKit(prisma, orgId);
    const options = { ai: item.aiChecks, as_of: new Date().toISOString().slice(0, 10) };
    if (item.kind === "image") {
      if (!version.imageData || !version.imageMime) throw new HttpError(409, "conflict", "This image post has no image");
      result = await client.analyzeImage(
        { org_id: orgId, channel: Channel.parse(item.channel), alt_text: version.altText, brand_kit: brandKit,
          assets: await loadImageAssets(prisma, orgId), options },
        { buffer: Buffer.from(version.imageData), mimetype: version.imageMime, originalname: version.sourceFileName ?? "image" },
      );
    } else {
      result = await client.analyze({
        org_id: orgId,
        content: { text: version.body, channel: Channel.parse(item.channel) },
        brand_kit: brandKit,
        options,
      });
    }
  } catch (err) {
    const message = err instanceof HttpError ? err.message : "Analysis failed";
    logger.warn({ err, runId: run.id }, "analysis failed");
    return prisma.$transaction(async (tx) => {
      await audit(tx, {
        orgId,
        actorId,
        action: "analysis.failed",
        entityType: "ContentItem",
        entityId: contentItemId,
        data: { runId: run.id, versionId, error: message },
      });
      return tx.analysisRun.update({
        where: { id: run.id },
        data: { status: "FAILED", error: message, completedAt: new Date() },
      });
    });
  }

  return prisma.$transaction(async (tx) => {
    const previous = await tx.finding.findMany({
      where: { contentItemId, status: { in: ["OPEN", "DISPUTED"] } },
      include: { responses: { orderBy: { createdAt: "desc" } } },
    });
    const prevByFingerprint = new Map(previous.map((f) => [f.fingerprint, f]));
    const newFingerprints = new Set(result.findings.map((f) => f.fingerprint));

    for (const f of result.findings) {
      const prior = prevByFingerprint.get(f.fingerprint);
      const priorDispute = prior?.status === "DISPUTED" ? prior.responses.find((r) => r.action === "DISPUTE") : undefined;
      const created = await tx.finding.create({
        data: {
          orgId,
          runId: run.id,
          contentItemId,
          versionId,
          fingerprint: f.fingerprint,
          kind: f.kind,
          category: f.category,
          severity: f.severity,
          origins: f.origins,
          spanStart: f.span?.start ?? null,
          spanEnd: f.span?.end ?? null,
          quote: f.quote,
          explanation: f.explanation,
          sourceType: f.source?.type ?? null,
          sourceCode: f.source?.code ?? null,
          sourceClauseCode: f.source?.clause_code ?? null,
          sourceText: f.source?.text ?? null,
          confidence: f.confidence,
          fixStart: f.fix?.start ?? null,
          fixEnd: f.fix?.end ?? null,
          fixReplacement: f.fix?.replacement ?? null,
          boxX: f.box?.x ?? null,
          boxY: f.box?.y ?? null,
          boxW: f.box?.w ?? null,
          boxH: f.box?.h ?? null,
          status: priorDispute ? "DISPUTED" : "OPEN",
          carriedFromId: prior?.id ?? null,
        },
      });
      if (priorDispute) {
        await tx.findingResponse.create({
          data: {
            orgId,
            findingId: created.id,
            memberId: priorDispute.memberId,
            action: "DISPUTE",
            reason: priorDispute.reason,
            createdAt: priorDispute.createdAt,
          },
        });
      }
    }

    const reproduced = previous.filter((f) => newFingerprints.has(f.fingerprint)).map((f) => f.id);
    const fixed = previous.filter((f) => !newFingerprints.has(f.fingerprint)).map((f) => f.id);
    if (reproduced.length) {
      await tx.finding.updateMany({ where: { id: { in: reproduced } }, data: { status: "SUPERSEDED" } });
    }
    if (fixed.length) {
      await tx.finding.updateMany({
        where: { id: { in: fixed } },
        data: { status: "CLOSED", closedInVersionId: versionId },
      });
    }

    if (result.rewrites.length) {
      await tx.rewrite.createMany({
        data: result.rewrites.map((r) => ({
          orgId,
          runId: run.id,
          key: r.id,
          start: r.start,
          end: r.end,
          original: r.original,
          text: r.text,
          fingerprints: r.finding_fingerprints,
        })),
      });
    }

    await audit(tx, {
      orgId,
      actorId,
      action: "analysis.completed",
      entityType: "ContentItem",
      entityId: contentItemId,
      data: {
        runId: run.id,
        versionId,
        findings: result.findings.length,
        closed: fixed.length,
        aiStatus: result.ai_status,
      },
    });

    if (result.image) {
      await tx.contentVersion.update({ where: { id: versionId }, data: { imageWidth: result.image.width, imageHeight: result.image.height } });
    }
    return tx.analysisRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        ocrText: result.ocr_text ?? null,
        notes: result.notes ?? [],
        aiStatus: result.ai_status,
        aiError: result.ai_error,
        model: result.model,
        stats: result.stats as Prisma.InputJsonValue,
        durationMs: result.stats.duration_ms,
        completedAt: new Date(),
      },
    });
  });
}
