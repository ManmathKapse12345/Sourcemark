import type { Prisma } from "@prisma/client";
import {
  AddClauseBody,
  CreateAssetBody,
  CreateFactBody,
  CreateGuidelineBody,
  CreateRuleBody,
  RuleConfigByType,
  UpdateClauseBody,
  UpdateFactBody,
  UpdateRuleBody,
  type RuleType,
} from "@sourcemark/contract";
import { Router } from "express";
import type { AnalysisClient } from "../analysis/client.js";
import { audit } from "../audit.js";
import { carryOverCodes, nextFreeCode } from "../content/clauseCodes.js";
import { member, requireRole } from "../auth/middleware.js";
import { prisma, type Db } from "../db.js";
import { factCode, guidelinePrefix, ruleCode } from "../db/codes.js";
import { owned } from "../db/scoped.js";
import { badRequest, conflict } from "../http/errors.js";
import { assertFileContent, uploader } from "../http/upload.js";
import { param, parseBody, parseForm } from "../http/validate.js";

const DAY_MS = 86_400_000;
const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const today = () => new Date().toISOString().slice(0, 10);

function parseRuleConfig(type: RuleType, config: unknown) {
  const parsed = RuleConfigByType[type].safeParse(config);
  if (!parsed.success) throw badRequest(`Invalid config for a ${type} rule`, parsed.error.issues);
  return parsed.data as Prisma.InputJsonValue;
}

// Two rules are the same check when type and config match, ignoring key order, word order in lists and case.
function sameCheck(a: unknown, b: unknown) {
  const norm = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(norm).map((x) => JSON.stringify(x)).sort()
      : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)).map(([k, x]) => [k, norm(x)]))
      : typeof v === "string" ? v.trim().toLowerCase() : v;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

async function assertClauseExists(db: Db, orgId: string, code: string | null | undefined) {
  if (!code) return;
  const found = await db.clause.findFirst({ where: { orgId, code } });
  if (!found) throw badRequest(`No guideline clause with code ${code}`);
}

export function brandKitRouter(analysis: AnalysisClient, maxUploadMb: number) {
  const r = Router({ mergeParams: true });
  const upload = uploader(maxUploadMb);
  const admin = requireRole("ADMIN");

  // ---------- Guidelines and clauses ----------

  r.get("/guidelines", async (req, res) => {
    const { orgId } = member(req);
    const guidelines = await prisma.guideline.findMany({
      where: { orgId },
      include: { versions: { select: { id: true, number: true, status: true, publishedAt: true, createdAt: true } } },
      orderBy: { createdAt: "asc" },
    });
    res.json({ guidelines });
  });

  r.get("/guidelines/:guidelineId", async (req, res) => {
    const { orgId } = member(req);
    const g = owned(
      await prisma.guideline.findUnique({
        where: { id: param(req.params.guidelineId, "guidelineId") },
        include: {
          versions: {
            orderBy: { number: "desc" },
            include: { clauses: { orderBy: { position: "asc" } } },
          },
        },
      }),
      orgId,
      "Guideline",
    );
    res.json(g);
  });

  // Upload a guideline (PDF/DOCX/TXT as "file", or "text"). Clauses are extracted into a
  // DRAFT version for the admin to check before publishing.
  r.post("/guidelines", admin, upload.single("file"), async (req, res) => {
    const me = member(req);
    const body = parseForm(CreateGuidelineBody, req.body);
    if (req.file) assertFileContent(req.file);
    if (!req.file && !body.text) throw badRequest("Upload a file or provide text");

    const prefix = await guidelinePrefix(prisma, me.orgId);
    const extracted = await analysis.extractGuideline({ file: req.file, text: body.text, prefix });
    if (!extracted.clauses.length) throw badRequest("No clauses could be extracted from this guideline");

    const created = await prisma.$transaction(async (tx) => {
      const g = await tx.guideline.create({ data: { orgId: me.orgId, title: body.title, prefix } });
      const v = await tx.guidelineVersion.create({
        data: {
          orgId: me.orgId,
          guidelineId: g.id,
          number: 1,
          sourceFileName: req.file?.originalname ?? null,
          rawText: extracted.clauses.map((c) => c.text).join("\n\n"),
          createdById: me.id,
        },
      });
      await tx.clause.createMany({
        data: extracted.clauses.map((c, i) => ({
          orgId: me.orgId,
          versionId: v.id,
          code: c.code,
          heading: c.heading,
          text: c.text,
          position: i,
        })),
      });
      await audit(tx, {
        orgId: me.orgId,
        actorId: me.id,
        action: "guideline.uploaded",
        entityType: "Guideline",
        entityId: g.id,
        data: { versionId: v.id, clauses: extracted.clauses.length },
      });
      return { guideline: g, version: v };
    });
    res.status(201).json({ ...created, clauses: extracted.clauses, warnings: extracted.warnings });
  });

  // A new version of an existing guideline keeps the same prefix, and each clause keeps its code
  // (matched by text against the previous version), so rules and findings citing it stay correct.
  r.post("/guidelines/:guidelineId/versions", admin, upload.single("file"), async (req, res) => {
    const me = member(req);
    const g = owned(
      await prisma.guideline.findUnique({
        where: { id: param(req.params.guidelineId, "guidelineId") },
        include: { versions: { orderBy: { number: "desc" } } },
      }),
      me.orgId,
      "Guideline",
    );
    if (g.versions.some((v) => v.status === "DRAFT")) {
      throw conflict("This guideline already has a draft version; publish or delete it first");
    }
    const text = typeof req.body?.text === "string" ? req.body.text : undefined;
    if (req.file) assertFileContent(req.file);
    if (!req.file && !text) throw badRequest("Upload a file or provide text");
    const extracted = await analysis.extractGuideline({ file: req.file, text, prefix: g.prefix });
    const history = await prisma.clause.findMany({ where: { version: { guidelineId: g.id } }, select: { code: true, text: true, versionId: true } });
    const clauses = carryOverCodes(
      extracted.clauses,
      history.filter((c) => c.versionId === g.versions[0]?.id),
      history.map((c) => c.code),
    );

    const version = await prisma.$transaction(async (tx) => {
      const v = await tx.guidelineVersion.create({
        data: {
          orgId: me.orgId,
          guidelineId: g.id,
          number: (g.versions[0]?.number ?? 0) + 1,
          sourceFileName: req.file?.originalname ?? null,
          rawText: extracted.clauses.map((c) => c.text).join("\n\n"),
          createdById: me.id,
        },
      });
      await tx.clause.createMany({
        data: clauses.map((c, i) => ({ orgId: me.orgId, versionId: v.id, code: c.code, heading: c.heading, text: c.text, position: i })),
      });
      await audit(tx, { orgId: me.orgId, actorId: me.id, action: "guideline.version_uploaded", entityType: "Guideline", entityId: g.id, data: { versionId: v.id } });
      return v;
    });
    res.status(201).json({ version, clauses, warnings: extracted.warnings });
  });

  async function draftVersion(orgId: string, versionId: string) {
    const v = owned(await prisma.guidelineVersion.findUnique({ where: { id: versionId }, include: { guideline: true } }), orgId, "Guideline version");
    if (v.status !== "DRAFT") throw conflict("Only draft guideline versions can be edited");
    return v;
  }

  r.delete("/guideline-versions/:versionId", admin, async (req, res) => {
    const me = member(req);
    const v = await draftVersion(me.orgId, param(req.params.versionId, "versionId"));
    await prisma.$transaction(async (tx) => {
      await tx.guidelineVersion.delete({ where: { id: v.id } });
      await audit(tx, { orgId: me.orgId, actorId: me.id, action: "guideline.draft_deleted", entityType: "Guideline", entityId: v.guidelineId, data: { versionId: v.id } });
    });
    res.status(204).end();
  });

  r.post("/guideline-versions/:versionId/clauses", admin, async (req, res) => {
    const me = member(req);
    const v = await draftVersion(me.orgId, param(req.params.versionId, "versionId"));
    const body = parseBody(AddClauseBody, req.body);
    const current = await prisma.clause.findMany({ where: { versionId: v.id }, orderBy: { position: "asc" }, select: { code: true } });
    const count = current.length;
    // A new clause never takes a code the guideline has used before, so rules citing it keep their meaning.
    const used = new Set((await prisma.clause.findMany({ where: { version: { guidelineId: v.guidelineId } }, select: { code: true } })).map((c) => c.code));
    const code = body.code ?? nextFreeCode(current.at(-1)?.code ?? `${v.guideline.prefix}-1.0`, used);
    if (!code.startsWith(`${v.guideline.prefix}-`)) throw badRequest(`Clause codes in this guideline start with ${v.guideline.prefix}-`);
    if (current.some((c) => c.code === code)) throw conflict(`This version already has a clause ${code}`);
    const clause = await prisma.$transaction(async (tx) => {
      const c = await tx.clause.create({
        data: { orgId: me.orgId, versionId: v.id, code, heading: body.heading ?? null, text: body.text, position: count },
      });
      await audit(tx, { orgId: me.orgId, actorId: me.id, action: "clause.added", entityType: "Clause", entityId: c.id, data: { code } });
      return c;
    });
    res.status(201).json(clause);
  });

  r.patch("/clauses/:clauseId", admin, async (req, res) => {
    const me = member(req);
    const clause = owned(await prisma.clause.findUnique({ where: { id: param(req.params.clauseId, "clauseId") } }), me.orgId, "Clause");
    await draftVersion(me.orgId, clause.versionId);
    const body = parseBody(UpdateClauseBody, req.body);
    const updated = await prisma.$transaction(async (tx) => {
      const c = await tx.clause.update({ where: { id: clause.id }, data: body });
      await audit(tx, { orgId: me.orgId, actorId: me.id, action: "clause.edited", entityType: "Clause", entityId: c.id, data: { before: clause.text, after: c.text } });
      return c;
    });
    res.json(updated);
  });

  r.delete("/clauses/:clauseId", admin, async (req, res) => {
    const me = member(req);
    const clause = owned(await prisma.clause.findUnique({ where: { id: param(req.params.clauseId, "clauseId") } }), me.orgId, "Clause");
    await draftVersion(me.orgId, clause.versionId);
    await prisma.$transaction(async (tx) => {
      await tx.clause.delete({ where: { id: clause.id } });
      await audit(tx, { orgId: me.orgId, actorId: me.id, action: "clause.deleted", entityType: "Clause", entityId: clause.id, data: { code: clause.code } });
    });
    res.status(204).end();
  });

  // Publishing embeds every clause for retrieval and supersedes the previous published version.
  r.post("/guideline-versions/:versionId/publish", admin, async (req, res) => {
    const me = member(req);
    const v = await draftVersion(me.orgId, param(req.params.versionId, "versionId"));
    const clauses = await prisma.clause.findMany({ where: { versionId: v.id }, orderBy: { position: "asc" } });
    if (!clauses.length) throw conflict("A guideline version needs at least one clause");

    const embedded = await analysis.embed({
      texts: clauses.map((c) => (c.heading ? `${c.heading}: ${c.text}` : c.text)),
      task: "document",
    });

    await prisma.$transaction(async (tx) => {
      if (embedded) {
        for (const [i, c] of clauses.entries()) {
          const vector = `[${embedded.vectors[i]!.join(",")}]`;
          await tx.$executeRaw`UPDATE "Clause" SET "embedding" = ${vector}::vector, "embeddingModel" = ${embedded.model} WHERE "id" = ${c.id}`;
        }
      }
      await tx.guidelineVersion.updateMany({
        where: { guidelineId: v.guidelineId, status: "PUBLISHED" },
        data: { status: "SUPERSEDED" },
      });
      await tx.guidelineVersion.update({ where: { id: v.id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
      await audit(tx, {
        orgId: me.orgId,
        actorId: me.id,
        action: "guideline.published",
        entityType: "Guideline",
        entityId: v.guidelineId,
        data: { versionId: v.id, clauses: clauses.length, embeddings: embedded ? embedded.model : "skipped" },
      });
    });
    res.json({ published: v.id, clauses: clauses.length, embeddings: embedded ? "stored" : "skipped" });
  });

  // Suggested rules are returned for the admin to confirm; nothing is saved here.
  r.post("/guideline-versions/:versionId/suggest-rules", admin, async (req, res) => {
    const me = member(req);
    const v = owned(await prisma.guidelineVersion.findUnique({ where: { id: param(req.params.versionId, "versionId") } }), me.orgId, "Guideline version");
    const clauses = await prisma.clause.findMany({ where: { versionId: v.id }, orderBy: { position: "asc" } });
    if (!clauses.length) throw conflict("This version has no clauses");
    const result = await analysis.suggestRules({ clauses: clauses.map((c) => ({ code: c.code, heading: c.heading, text: c.text })) });
    res.json(result);
  });

  // ---------- Rules ----------

  r.get("/rules", async (req, res) => {
    const { orgId } = member(req);
    res.json({ rules: await prisma.rule.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } }) });
  });

  r.post("/rules", admin, async (req, res) => {
    const me = member(req);
    const body = parseBody(CreateRuleBody, req.body);
    const config = parseRuleConfig(body.type, body.config);
    await assertClauseExists(prisma, me.orgId, body.clauseCode);
    const existing = (await prisma.rule.findMany({ where: { orgId: me.orgId, type: body.type } })).find((r) => sameCheck(r.config, config));
    if (existing) {
      throw conflict(
        `${existing.code} already checks this${existing.active ? "" : " (it is switched off; switch it on instead)"}`,
        { rule: { id: existing.id, code: existing.code, active: existing.active } },
      );
    }
    const rule = await prisma.$transaction(async (tx) => {
      const created = await tx.rule.create({
        data: {
          orgId: me.orgId,
          code: await ruleCode(tx, me.orgId),
          type: body.type,
          severity: body.severity,
          clauseCode: body.clauseCode ?? null,
          message: body.message,
          config,
        },
      });
      await audit(tx, { orgId: me.orgId, actorId: me.id, action: "rule.created", entityType: "Rule", entityId: created.id, data: { code: created.code } });
      return created;
    });
    res.status(201).json(rule);
  });

  r.patch("/rules/:ruleId", admin, async (req, res) => {
    const me = member(req);
    const rule = owned(await prisma.rule.findUnique({ where: { id: param(req.params.ruleId, "ruleId") } }), me.orgId, "Rule");
    const body = parseBody(UpdateRuleBody, req.body);
    await assertClauseExists(prisma, me.orgId, body.clauseCode);
    const data: Prisma.RuleUpdateInput = {
      severity: body.severity,
      clauseCode: body.clauseCode,
      message: body.message,
      active: body.active,
      config: body.config ? parseRuleConfig(rule.type, body.config) : undefined,
    };
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.rule.update({ where: { id: rule.id }, data });
      await audit(tx, {
        orgId: me.orgId,
        actorId: me.id,
        action: "rule.updated",
        entityType: "Rule",
        entityId: rule.id,
        data: { code: rule.code, before: { severity: rule.severity, message: rule.message, config: rule.config, active: rule.active }, changes: body as Prisma.InputJsonValue },
      });
      return u;
    });
    res.json(updated);
  });

  // ---------- Facts ----------

  r.get("/facts", async (req, res) => {
    const { orgId } = member(req);
    // By default only facts in use: switched on and not ended. ?all=true adds the history.
    const includeInactive = req.query.all === "true";
    const facts = await prisma.fact.findMany({
      where: {
        orgId,
        ...(includeInactive ? {} : { active: true, OR: [{ validUntil: null }, { validUntil: { gte: toDate(today()) } }] }),
      },
      orderBy: [{ subject: "asc" }, { attribute: "asc" }, { validFrom: "desc" }],
    });
    res.json({ facts });
  });

  // Adding a fact for a subject and attribute that already has a current value ends the old
  // value the day before, so drafts that still use it can be told exactly what changed.
  r.post("/facts", admin, async (req, res) => {
    const me = member(req);
    const body = parseBody(CreateFactBody, req.body);
    const validFrom = toDate(body.validFrom ?? today());
    const fact = await prisma.$transaction(async (tx) => {
      const current = await tx.fact.findFirst({
        where: {
          orgId: me.orgId,
          active: true,
          validUntil: null,
          subject: { equals: body.subject, mode: "insensitive" },
          attribute: { equals: body.attribute, mode: "insensitive" },
        },
      });
      if (current) {
        if (current.validFrom >= validFrom) {
          throw conflict(`${current.code} is already valid from ${current.validFrom.toISOString().slice(0, 10)}; use a later validFrom`);
        }
        await tx.fact.update({ where: { id: current.id }, data: { validUntil: new Date(validFrom.getTime() - DAY_MS) } });
      }
      const created = await tx.fact.create({
        data: {
          orgId: me.orgId,
          code: await factCode(tx, me.orgId),
          subject: body.subject,
          aliases: body.aliases,
          attribute: body.attribute,
          kind: body.kind,
          value: body.value,
          unit: body.unit ?? null,
          validFrom,
          source: body.source ?? null,
        },
      });
      await audit(tx, {
        orgId: me.orgId,
        actorId: me.id,
        action: "fact.created",
        entityType: "Fact",
        entityId: created.id,
        data: { code: created.code, supersedes: current?.code ?? null, value: created.value },
      });
      return created;
    });
    res.status(201).json(fact);
  });

  r.patch("/facts/:factId", admin, async (req, res) => {
    const me = member(req);
    const fact = owned(await prisma.fact.findUnique({ where: { id: param(req.params.factId, "factId") } }), me.orgId, "Fact");
    const body = parseBody(UpdateFactBody, req.body);
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.fact.update({ where: { id: fact.id }, data: body });
      await audit(tx, { orgId: me.orgId, actorId: me.id, action: "fact.updated", entityType: "Fact", entityId: fact.id, data: { code: fact.code, changes: body } });
      return u;
    });
    res.json(updated);
  });

  // ---------- Assets (metadata; image checks arrive in Round 3) ----------

  r.get("/assets", async (req, res) => {
    const { orgId } = member(req);
    res.json({ assets: await prisma.asset.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } }) });
  });

  r.post("/assets", admin, async (req, res) => {
    const me = member(req);
    const body = parseBody(CreateAssetBody, req.body);
    const asset = await prisma.$transaction(async (tx) => {
      const a = await tx.asset.create({
        data: { orgId: me.orgId, name: body.name, type: body.type, url: body.url ?? null, colors: body.colors, notes: body.notes ?? null },
      });
      await audit(tx, { orgId: me.orgId, actorId: me.id, action: "asset.created", entityType: "Asset", entityId: a.id });
      return a;
    });
    res.status(201).json(asset);
  });

  r.delete("/assets/:assetId", admin, async (req, res) => {
    const me = member(req);
    const asset = owned(await prisma.asset.findUnique({ where: { id: param(req.params.assetId, "assetId") } }), me.orgId, "Asset");
    await prisma.$transaction(async (tx) => {
      await tx.asset.delete({ where: { id: asset.id } });
      await audit(tx, { orgId: me.orgId, actorId: me.id, action: "asset.deleted", entityType: "Asset", entityId: asset.id, data: { name: asset.name } });
    });
    res.status(204).end();
  });

  return r;
}
