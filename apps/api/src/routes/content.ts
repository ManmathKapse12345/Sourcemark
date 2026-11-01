import type { ContentState, ContentVersion, Prisma } from "@prisma/client";
import {
  CommentBody,
  ContentState as ContentStateEnum,
  CreateContentBody,
  CreateVersionBody,
  FindingResponseBody,
  TransitionBody,
} from "@sourcemark/contract";
import { Router, type Request } from "express";
import { z } from "zod";
import type { AnalysisClient } from "../analysis/client.js";
import { runAnalysis } from "../analysis/runAnalysis.js";
import { audit } from "../audit.js";
import { member, requireRole } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { owned } from "../db/scoped.js";
import { applyEdits, type Edit } from "../content/applyEdits.js";
import { badRequest, conflict, forbidden, notFound } from "../http/errors.js";
import { assertFileContent, isImage, uploader } from "../http/upload.js";
import { param, parseBody, parseForm } from "../http/validate.js";
import { availableActions, EDITABLE_STATES, planTransition } from "../workflow/stateMachine.js";

async function loadItem(req: Request, id: unknown) {
  const me = member(req);
  return owned(await prisma.contentItem.findUnique({ where: { id: param(id, "contentId") } }), me.orgId, "Content");
}

const latestRun = (contentItemId: string) =>
  prisma.analysisRun.findFirst({
    where: { contentItemId },
    orderBy: { createdAt: "desc" },
    include: {
      findings: {
        include: { responses: { orderBy: { createdAt: "asc" } } },
        orderBy: [{ spanStart: "asc" }, { createdAt: "asc" }],
      },
      rewrites: { orderBy: { start: "asc" } },
    },
  });

// Violations still open on the latest run. These block RESOLVE until the creator fixes them
// (a new version that passes) or disputes them with a reason. "Needs human check" findings
// do not block: they go to the reviewer.
function blockingFindings(run: Awaited<ReturnType<typeof latestRun>>) {
  return run?.findings.filter((f) => f.kind === "violation" && f.status === "OPEN") ?? [];
}

const AltText = z.string().trim().max(1000).optional();

// A new version of an image post: a new image (multipart "file"), new alt text, or both. Text edits and
// suggested fixes do not apply: the writer changes the image itself.
async function newImageVersion(req: Request, contentItemId: string, latest: ContentVersion) {
  const me = member(req);
  const altText = AltText.parse(typeof req.body?.altText === "string" ? req.body.altText : undefined);
  if (!req.file && altText === undefined) {
    throw conflict("Change an image post by uploading a new image or editing its alt text");
  }
  if (req.file) {
    assertFileContent(req.file);
    if (!isImage(req.file)) throw badRequest("Upload a PNG, JPEG or WebP image");
  }
  const image = req.file ?? null;
  if (!image && altText === (latest.altText ?? "")) throw conflict("The new version is identical to the current one");
  return prisma.$transaction(async (tx) => {
    const v = await tx.contentVersion.create({
      data: {
        orgId: me.orgId, contentItemId, number: latest.number + 1, createdById: me.id,
        body: altText ?? latest.altText ?? "",
        altText: altText ?? latest.altText,
        imageData: image ? new Uint8Array(image.buffer) : latest.imageData,
        imageMime: image ? image.mimetype : latest.imageMime,
        sourceFileName: image ? image.originalname : latest.sourceFileName,
      },
      omit: { imageData: true },
    });
    await tx.contentItem.update({ where: { id: contentItemId }, data: { updatedAt: new Date() } });
    await audit(tx, {
      orgId: me.orgId, actorId: me.id, action: "content.version_created", entityType: "ContentItem", entityId: contentItemId,
      data: { versionId: v.id, number: v.number, newImage: !!image, altTextChanged: altText !== undefined },
    });
    return v;
  });
}

export function contentRouter(analysis: AnalysisClient, maxUploadMb: number) {
  const r = Router({ mergeParams: true });
  const upload = uploader(maxUploadMb, "documents-or-images");

  r.get("/content", async (req, res) => {
    const me = member(req);
    const state = req.query.state ? ContentStateEnum.parse(req.query.state) : undefined;
    const items = await prisma.contentItem.findMany({
      where: { orgId: me.orgId, ...(state ? { state } : {}), ...(req.query.mine === "true" ? { authorId: me.id } : {}) },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    res.json({ items });
  });

  r.post("/content", requireRole("CREATOR"), upload.single("file"), async (req, res) => {
    const me = member(req);
    const body = parseForm(CreateContentBody, req.body);
    let text = body.body;
    let sourceFileName: string | null = null;
    // An image post: the image is reviewed as it is (colours, logos, contrast, alt text, its text).
    const image = req.file && isImage(req.file) ? req.file : null;
    if (req.file) {
      assertFileContent(req.file);
      sourceFileName = req.file.originalname;
      if (!image) text = (await analysis.parse(req.file)).text;
    }
    if (!image && !text?.trim()) throw badRequest("Provide body text or upload a file with text in it");

    const created = await prisma.$transaction(async (tx) => {
      const item = await tx.contentItem.create({
        data: { orgId: me.orgId, title: body.title, channel: body.channel, aiChecks: body.aiChecks, authorId: me.id,
                kind: image ? "image" : "text" },
      });
      const version = await tx.contentVersion.create({
        data: {
          orgId: me.orgId, contentItemId: item.id, number: 1, sourceFileName, createdById: me.id,
          body: image ? (body.altText ?? "") : text!,
          ...(image ? { imageData: new Uint8Array(image.buffer), imageMime: image.mimetype, altText: body.altText ?? null } : {}),
        },
        omit: { imageData: true },
      });
      await audit(tx, {
        orgId: me.orgId,
        actorId: me.id,
        action: "content.created",
        entityType: "ContentItem",
        entityId: item.id,
        data: { versionId: version.id, channel: body.channel, aiChecks: body.aiChecks, kind: item.kind },
      });
      return { item, version };
    });
    res.status(201).json(created);
  });

  r.get("/content/:contentId", async (req, res) => {
    const me = member(req);
    const item = await loadItem(req, req.params.contentId);
    const [versions, run, comments, events, author] = await Promise.all([
      prisma.contentVersion.findMany({ where: { contentItemId: item.id }, orderBy: { number: "desc" }, omit: { imageData: true } }),
      latestRun(item.id),
      prisma.comment.findMany({ where: { contentItemId: item.id }, orderBy: { createdAt: "asc" } }),
      prisma.approvalEvent.findMany({ where: { contentItemId: item.id }, orderBy: { createdAt: "asc" } }),
      prisma.member.findUnique({ where: { id: item.authorId }, include: { user: { select: { email: true, name: true } } } }),
    ]);
    const closedCount = await prisma.finding.count({ where: { contentItemId: item.id, status: "CLOSED" } });
    res.json({
      item,
      author: author ? { memberId: author.id, email: author.user.email, name: author.user.name } : null,
      // Image bytes are never inlined: GET /content/:id/versions/:versionId/image serves them.
      versions: versions.map((v) => ({ ...v, hasImage: v.imageMime !== null })),
      latestRun: run,
      blockingFindingIds: blockingFindings(run).map((f) => f.id),
      closedFindingCount: closedCount,
      comments,
      events,
      availableActions: availableActions(item.state, { roles: me.roles, isAuthor: item.authorId === me.id }),
    });
  });

  r.get("/content/:contentId/versions/:versionId/image", async (req, res) => {
    const item = await loadItem(req, req.params.contentId);
    const version = await prisma.contentVersion.findUnique({ where: { id: param(req.params.versionId, "versionId") } });
    if (!version || version.contentItemId !== item.id || !version.imageData || !version.imageMime) throw notFound("Image");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.type(version.imageMime).send(Buffer.from(version.imageData));
  });

  r.post("/content/:contentId/versions", upload.single("file"), async (req, res) => {
    const me = member(req);
    const item = await loadItem(req, req.params.contentId);
    if (item.authorId !== me.id) throw forbidden("Only the author can add versions");
    if (!EDITABLE_STATES.includes(item.state)) throw conflict(`Content that is ${item.state} cannot be edited`);
    const latest = await prisma.contentVersion.findFirstOrThrow({ where: { contentItemId: item.id }, orderBy: { number: "desc" } });

    if (item.kind === "image") {
      const version = await newImageVersion(req, item.id, latest);
      const run = item.state === "CHECKING"
        ? await runAnalysis(analysis, { orgId: me.orgId, contentItemId: item.id, versionId: version.id, actorId: me.id })
        : null;
      res.status(201).json({ version, run });
      return;
    }
    if (req.file) throw badRequest("A text post is changed by editing its text, not by uploading a file");
    const body = parseBody(CreateVersionBody, req.body);

    let newBody: string;
    if (body.body !== undefined) {
      newBody = body.body;
    } else {
      const run = await latestRun(item.id);
      if (!run || run.versionId !== latest.id || run.status !== "COMPLETED") {
        throw conflict("The latest version has no completed check to apply fixes from");
      }
      const edits: Edit[] = [];
      if (body.applyResponses) {
        for (const f of run.findings) {
          if (f.status !== "OPEN") continue;
          const last = f.responses.at(-1);
          if (last?.action === "ACCEPT") {
            if (f.fixStart === null || f.fixEnd === null || f.fixReplacement === null) {
              throw conflict(`Finding ${f.id} has no suggested fix; edit it instead`);
            }
            edits.push({ start: f.fixStart, end: f.fixEnd, replacement: f.fixReplacement, label: `the fix for "${f.quote}"` });
          } else if (last?.action === "EDIT") {
            if (f.spanStart === null || f.spanEnd === null) throw conflict(`Finding ${f.id} is not tied to a span of text`);
            edits.push({ start: f.spanStart, end: f.spanEnd, replacement: last.editedText ?? "", label: `your edit of "${f.quote}"` });
          }
        }
      }
      for (const key of body.applyRewriteIds ?? []) {
        const rw = run.rewrites.find((x) => x.key === key);
        if (!rw) throw badRequest(`Unknown rewrite ${key}`);
        edits.push({ start: rw.start, end: rw.end, replacement: rw.text, label: `rewrite ${key}` });
      }
      if (!edits.length) throw conflict("There are no accepted or edited fixes to apply");
      newBody = applyEdits(latest.body, edits);
    }
    if (newBody === latest.body) throw conflict("The new version is identical to the current one");

    const version = await prisma.$transaction(async (tx) => {
      const v = await tx.contentVersion.create({
        data: { orgId: me.orgId, contentItemId: item.id, number: latest.number + 1, body: newBody, createdById: me.id },
      });
      await tx.contentItem.update({ where: { id: item.id }, data: { updatedAt: new Date() } });
      await audit(tx, {
        orgId: me.orgId,
        actorId: me.id,
        action: "content.version_created",
        entityType: "ContentItem",
        entityId: item.id,
        data: { versionId: v.id, number: v.number, appliedRewrites: body.applyRewriteIds ?? [], appliedResponses: !!body.applyResponses },
      });
      return v;
    });

    // While checking, every new version is re-analysed so findings close only when the text passes.
    const run = item.state === "CHECKING"
      ? await runAnalysis(analysis, { orgId: me.orgId, contentItemId: item.id, versionId: version.id, actorId: me.id })
      : null;
    res.status(201).json({ version, run });
  });

  r.post("/content/:contentId/transitions", async (req, res) => {
    const me = member(req);
    const item = await loadItem(req, req.params.contentId);
    const body = parseBody(TransitionBody, req.body);
    const to = planTransition(item.state, body.action, { roles: me.roles, isAuthor: item.authorId === me.id });
    const latest = await prisma.contentVersion.findFirstOrThrow({ where: { contentItemId: item.id }, orderBy: { number: "desc" } });

    if (body.action === "RESOLVE") {
      const run = await latestRun(item.id);
      if (!run || run.versionId !== latest.id || run.status !== "COMPLETED") {
        throw conflict("The latest version has not been checked successfully yet");
      }
      const blocking = blockingFindings(run);
      if (blocking.length) {
        throw conflict("Fix or dispute every open violation before sending to review", {
          findings: blocking.map((f) => ({ id: f.id, quote: f.quote, source: f.sourceCode })),
        });
      }
    }
    if ((body.action === "REQUEST_CHANGES" || body.action === "REJECT") && !body.note?.trim()) {
      throw badRequest("Say what needs to change");
    }

    await prisma.$transaction(async (tx) => {
      const { count } = await tx.contentItem.updateMany({ where: { id: item.id, state: item.state }, data: { state: to } });
      if (!count) throw conflict("This content changed state in the meantime; reload and try again");
      await tx.approvalEvent.create({
        data: {
          orgId: me.orgId,
          contentItemId: item.id,
          versionId: latest.id,
          action: body.action,
          fromState: item.state,
          toState: to,
          actorId: me.id,
          note: body.note ?? null,
        },
      });
      await audit(tx, {
        orgId: me.orgId,
        actorId: me.id,
        action: `content.${body.action.toLowerCase()}`,
        entityType: "ContentItem",
        entityId: item.id,
        data: { from: item.state, to, versionId: latest.id, note: body.note ?? null } as Prisma.InputJsonValue,
      });
    });

    const run = body.action === "SUBMIT"
      ? await runAnalysis(analysis, { orgId: me.orgId, contentItemId: item.id, versionId: latest.id, actorId: me.id })
      : null;
    res.json({ state: to as ContentState, run });
  });

  // Retry a failed or outdated check of the latest version.
  r.post("/content/:contentId/analyze", async (req, res) => {
    const me = member(req);
    const item = await loadItem(req, req.params.contentId);
    if (item.authorId !== me.id) throw forbidden("Only the author can re-run checks");
    if (item.state !== "CHECKING") throw conflict("Checks run while content is CHECKING; submit it first");
    const latest = await prisma.contentVersion.findFirstOrThrow({ where: { contentItemId: item.id }, orderBy: { number: "desc" } });
    const run = await runAnalysis(analysis, { orgId: me.orgId, contentItemId: item.id, versionId: latest.id, actorId: me.id });
    res.status(run.status === "FAILED" ? 502 : 200).json({ run });
  });

  r.post("/findings/:findingId/responses", async (req, res) => {
    const me = member(req);
    const finding = owned(await prisma.finding.findUnique({ where: { id: param(req.params.findingId, "findingId") } }), me.orgId, "Finding");
    const item = await loadItem(req, finding.contentItemId);
    const body = parseBody(FindingResponseBody, req.body);

    const isAuthor = item.authorId === me.id;
    const canRespond =
      (isAuthor && EDITABLE_STATES.includes(item.state)) ||
      (item.state === "IN_REVIEW" && me.roles.some((r) => r === "REVIEWER" || r === "APPROVER") && !isAuthor);
    if (!canRespond) throw forbidden("You cannot respond to findings on this content right now");
    if (finding.status !== "OPEN" && finding.status !== "DISPUTED") {
      throw conflict("This finding is from an older check; respond to the latest one");
    }
    if (body.action === "ACCEPT" && finding.fixReplacement === null) throw conflict("This finding has no suggested fix; edit it instead");
    if (body.action === "EDIT" && finding.spanStart === null) throw conflict("This finding is not tied to a span of text");

    const response = await prisma.$transaction(async (tx) => {
      const created = await tx.findingResponse.create({
        data: {
          orgId: me.orgId,
          findingId: finding.id,
          memberId: me.id,
          action: body.action,
          reason: body.reason ?? null,
          editedText: body.editedText ?? null,
        },
      });
      await tx.finding.update({
        where: { id: finding.id },
        data: { status: body.action === "DISPUTE" ? "DISPUTED" : "OPEN" },
      });
      await audit(tx, {
        orgId: me.orgId,
        actorId: me.id,
        action: `finding.${body.action.toLowerCase()}`,
        entityType: "Finding",
        entityId: finding.id,
        data: { contentItemId: item.id, source: finding.sourceCode, reason: body.reason ?? null },
      });
      return created;
    });
    res.status(201).json(response);
  });

  r.post("/content/:contentId/comments", async (req, res) => {
    const me = member(req);
    const item = await loadItem(req, req.params.contentId);
    const body = parseBody(CommentBody, req.body);
    if (body.findingId) {
      const f = await prisma.finding.findUnique({ where: { id: body.findingId } });
      if (!f || f.contentItemId !== item.id) throw badRequest("That finding is not on this content");
    }
    if (body.versionId) {
      const v = await prisma.contentVersion.findUnique({ where: { id: body.versionId } });
      if (!v || v.contentItemId !== item.id) throw badRequest("That version is not of this content");
    }
    const comment = await prisma.$transaction(async (tx) => {
      const c = await tx.comment.create({
        data: { orgId: me.orgId, contentItemId: item.id, versionId: body.versionId ?? null, findingId: body.findingId ?? null, authorId: me.id, body: body.body },
      });
      await audit(tx, { orgId: me.orgId, actorId: me.id, action: "comment.added", entityType: "ContentItem", entityId: item.id, data: { commentId: c.id } });
      return c;
    });
    res.status(201).json(comment);
  });

  r.get("/content/:contentId/audit", async (req, res) => {
    const me = member(req);
    const item = await loadItem(req, req.params.contentId);
    const findingIds = (await prisma.finding.findMany({ where: { contentItemId: item.id }, select: { id: true } })).map((f) => f.id);
    const entries = await prisma.auditLog.findMany({
      where: {
        orgId: me.orgId,
        OR: [
          { entityType: "ContentItem", entityId: item.id },
          { entityType: "Finding", entityId: { in: findingIds } },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    res.json({ entries });
  });

  return r;
}
