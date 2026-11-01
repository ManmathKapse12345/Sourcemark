import { RewordClauseBody } from "@sourcemark/contract";
import { Router } from "express";
import type { AnalysisClient } from "../analysis/client.js";
import { audit } from "../audit.js";
import { member, requireRole } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { computeHealth, type HealthEntry } from "../health/guidelineHealth.js";
import { conflict, notFound } from "../http/errors.js";
import { parseBody } from "../http/validate.js";

const MAX_FINDINGS = 5000;

async function report(orgId: string) {
  const findings = await prisma.finding.findMany({
    where: { orgId, sourceCode: { not: null } },
    orderBy: { createdAt: "desc" },
    take: MAX_FINDINGS,
    select: {
      id: true, contentItemId: true, fingerprint: true, sourceType: true, sourceCode: true, sourceClauseCode: true,
      origins: true, quote: true, explanation: true, status: true, createdAt: true,
      contentItem: { select: { title: true, state: true, authorId: true } },
      responses: { select: { memberId: true, action: true, reason: true, createdAt: true } },
    },
  });
  const health = computeHealth(findings.map(({ contentItem, ...f }) => ({ ...f, item: contentItem })));

  // What each entry says today: the published clause, or the rule's message.
  const [clauses, rules] = await Promise.all([
    prisma.clause.findMany({
      where: { orgId, version: { status: "PUBLISHED" } },
      select: { code: true, heading: true, text: true, version: { select: { guidelineId: true } } },
    }),
    prisma.rule.findMany({ where: { orgId }, select: { code: true, message: true, active: true } }),
  ]);
  const clauseBy = new Map(clauses.map((c) => [c.code, c]));
  const ruleBy = new Map(rules.map((r) => [r.code, r]));
  return {
    ...health,
    entries: health.entries.map((e) => {
      const c = e.kind === "clause" ? clauseBy.get(e.code) : undefined;
      const rule = e.kind === "rule" ? ruleBy.get(e.code) : undefined;
      return {
        ...e,
        heading: c?.heading ?? null,
        text: c?.text ?? rule?.message ?? null,
        guidelineId: c?.version.guidelineId ?? null,
        canReword: !!c,
      };
    }),
  };
}

async function entryFor(orgId: string, code: string): Promise<HealthEntry & { text: string | null; heading: string | null; canReword: boolean }> {
  const entry = (await report(orgId)).entries.find((e) => e.code === code);
  if (!entry) throw notFound("Guideline health entry");
  return entry;
}

// Guideline health (admin): which clauses people keep disputing, with the cases, an AI-suggested
// clearer wording, and a way to save that wording as a new draft version for review and publishing.
export function healthRouter(analysis: AnalysisClient) {
  const r = Router({ mergeParams: true });
  const admin = requireRole("ADMIN");

  r.get("/guideline-health", admin, async (req, res) => {
    res.json(await report(member(req).orgId));
  });

  // A suggestion only: nothing is saved until the admin applies it.
  r.post("/guideline-health/:code/suggest", admin, async (req, res) => {
    const me = member(req);
    const entry = await entryFor(me.orgId, String(req.params.code));
    if (!entry.canReword || !entry.text) throw conflict("Only published guideline clauses can be reworded");
    const cases = entry.cases.filter((c) => c.outcome === "disputed" || c.outcome === "overridden");
    if (!cases.length) throw conflict("Nobody has disputed this clause, so there is nothing to base a new wording on");
    const result = await analysis.rewordClause({
      clause: { code: entry.code, heading: entry.heading, text: entry.text },
      cases: cases.map((c) => ({ id: c.findingId, quote: c.quote, explanation: c.explanation, outcome: c.outcome, reason: c.reason })),
    });
    res.json({ code: entry.code, current: entry.text, suggestion: result.text, rationale: result.rationale, caseIds: result.case_ids });
  });

  // Copies the published version with this clause's new wording into a DRAFT version. Codes stay the
  // same, so rules and findings citing the clause keep pointing at it; the admin publishes as usual.
  r.post("/guideline-health/:code/apply", admin, async (req, res) => {
    const me = member(req);
    const code = String(req.params.code);
    const body = parseBody(RewordClauseBody, req.body);
    const clause = await prisma.clause.findFirst({
      where: { orgId: me.orgId, code, version: { status: "PUBLISHED" } },
      include: { version: { include: { guideline: { include: { versions: { orderBy: { number: "desc" } } } } } } },
    });
    if (!clause) throw notFound("Published clause");
    const g = clause.version.guideline;
    if (g.versions.some((v) => v.status === "DRAFT")) {
      throw conflict("This guideline already has a draft version; publish or delete it first");
    }
    if (body.text === clause.text) throw conflict("The new wording is the same as the current one");
    const published = await prisma.clause.findMany({ where: { versionId: clause.versionId }, orderBy: { position: "asc" } });
    const clauses = published.map((c) => ({ code: c.code, heading: c.heading, text: c.code === code ? body.text : c.text }));

    const version = await prisma.$transaction(async (tx) => {
      const v = await tx.guidelineVersion.create({
        data: {
          orgId: me.orgId,
          guidelineId: g.id,
          number: g.versions[0]!.number + 1,
          sourceFileName: null,
          rawText: clauses.map((c) => c.text).join("\n\n"),
          createdById: me.id,
        },
      });
      await tx.clause.createMany({
        data: clauses.map((c, i) => ({ orgId: me.orgId, versionId: v.id, code: c.code, heading: c.heading, text: c.text, position: i })),
      });
      await audit(tx, {
        orgId: me.orgId,
        actorId: me.id,
        action: "guideline.reworded",
        entityType: "Guideline",
        entityId: g.id,
        data: { versionId: v.id, code, before: clause.text, after: body.text },
      });
      return v;
    });
    res.status(201).json({ guidelineId: g.id, version, clauses });
  });

  return r;
}
