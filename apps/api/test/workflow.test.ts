import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { FakeAnalysis, makeApp, newUser, signIn } from "./helpers.js";

type Client = Awaited<ReturnType<typeof signIn>>;

describe("content workflow end to end", () => {
  const { app, analysis } = makeApp();
  let admin: Client, creator: Client, reviewer: Client, approver: Client, outsider: Client;
  let orgId: string;
  let otherOrgId: string;

  beforeAll(async () => {
    const users = { admin: newUser("admin"), creator: newUser("creator"), reviewer: newUser("reviewer"), approver: newUser("approver"), outsider: newUser("outsider") };
    admin = await signIn(app, users.admin);
    creator = await signIn(app, users.creator);
    reviewer = await signIn(app, users.reviewer);
    approver = await signIn(app, users.approver);
    outsider = await signIn(app, users.outsider);

    orgId = (await admin.post("/api/orgs", { name: "Test Org" }).expect(201)).body.org.id;
    for (const [u, roles] of [[users.creator, ["CREATOR"]], [users.reviewer, ["REVIEWER"]], [users.approver, ["APPROVER"]]] as const) {
      await admin.post(`/api/orgs/${orgId}/members`, { email: u.email, roles }).expect(201);
    }
    otherOrgId = (await outsider.post("/api/orgs", { name: "Someone else" }).expect(201)).body.org.id;
  });

  it("rejects missing and invalid tokens", async () => {
    await creator.raw().get("/api/me").expect(401);
    await creator.raw().get("/api/me").set({ Authorization: "Bearer not-a-jwt" }).expect(401);
  });

  it("enforces roles on the brand kit", async () => {
    await creator.post(`/api/orgs/${orgId}/rules`, {
      type: "banned_term", severity: "high", message: "No hype", config: { terms: ["miracle"] },
    }).expect(403);
    const rule = await admin.post(`/api/orgs/${orgId}/rules`, {
      type: "banned_term", severity: "high", message: "No hype", config: { terms: ["miracle"] },
    }).expect(201);
    expect(rule.body.code).toBe("R-1");
    expect(rule.body.config).toEqual({ terms: ["miracle"], replacement: null, category: "claim" });
    await admin.post(`/api/orgs/${orgId}/rules`, { type: "terminology", severity: "high", message: "x", config: {} }).expect(400);
  });

  it("supersedes facts so old values keep their history", async () => {
    const first = await admin.post(`/api/orgs/${orgId}/facts`, {
      subject: "Calm Barrier Moisturiser", attribute: "price", kind: "money", value: "499", unit: "INR", validFrom: "2025-01-01",
    }).expect(201);
    const second = await admin.post(`/api/orgs/${orgId}/facts`, {
      subject: "Calm Barrier Moisturiser", attribute: "price", kind: "money", value: "549", unit: "INR", validFrom: "2026-07-01",
    }).expect(201);
    expect([first.body.code, second.body.code]).toEqual(["F-1", "F-2"]);
    const old = await prisma.fact.findUniqueOrThrow({ where: { id: first.body.id } });
    expect(old.validUntil?.toISOString().slice(0, 10)).toBe("2026-06-30");
  });

  it("uploads, edits and publishes a guideline", async () => {
    const g = await admin.post(`/api/orgs/${orgId}/guidelines`, { title: "Brand guide", text: "1.1 Use the approved product name." }).expect(201);
    expect(g.body.guideline.prefix).toBe("G");
    const versionId = g.body.version.id;
    const detail = await admin.get(`/api/orgs/${orgId}/guidelines/${g.body.guideline.id}`).expect(200);
    const clauseId = detail.body.versions[0].clauses[0].id;
    await admin.patch(`/api/orgs/${orgId}/clauses/${clauseId}`, { text: "Use the full approved product name." }).expect(200);
    const pub = await admin.post(`/api/orgs/${orgId}/guideline-versions/${versionId}/publish`).expect(200);
    expect(pub.body.embeddings).toBe("skipped");
    await admin.patch(`/api/orgs/${orgId}/clauses/${clauseId}`, { text: "Too late" }).expect(409);
  });

  it("runs a draft from submission to approval", async () => {
    const base = `/api/orgs/${orgId}`;
    const created = await creator.post(`${base}/content`, { title: "Launch", channel: "instagram", body: "Our Cream is a miracle." }).expect(201);
    const id = created.body.item.id;
    expect(created.body.item.state).toBe("DRAFT");

    // Submitting runs the checks.
    const submitted = await creator.post(`${base}/content/${id}/transitions`, { action: "SUBMIT" }).expect(200);
    expect(submitted.body.state).toBe("CHECKING");
    expect(submitted.body.run.status).toBe("COMPLETED");
    expect(analysis.calls.at(-1)!.brand_kit.rules.map((r) => r.code)).toContain("R-1");

    // Open violations block review.
    const blocked = await creator.post(`${base}/content/${id}/transitions`, { action: "RESOLVE" }).expect(409);
    expect(blocked.body.error.details.findings).toHaveLength(2);

    let detail = await creator.get(`${base}/content/${id}`).expect(200);
    const findings = detail.body.latestRun.findings as { id: string; fingerprint: string }[];
    const cream = findings.find((f) => f.fingerprint === "fp-cream")!;
    const miracle = findings.find((f) => f.fingerprint === "fp-miracle")!;

    // Accepting a fix does not change anything by itself; a dispute needs a reason.
    await creator.post(`${base}/findings/${cream.id}/responses`, { action: "ACCEPT" }).expect(201);
    await creator.post(`${base}/findings/${miracle.id}/responses`, { action: "DISPUTE" }).expect(400);
    await creator.post(`${base}/findings/${miracle.id}/responses`, { action: "DISPUTE", reason: "Approved by legal for this campaign" }).expect(201);
    await reviewer.post(`${base}/findings/${cream.id}/responses`, { action: "DISPUTE", reason: "Reviewer cannot dispute yet" }).expect(403);

    // A new version applies the accepted fix and is checked again.
    const v2 = await creator.post(`${base}/content/${id}/versions`, { applyResponses: true }).expect(201);
    expect(v2.body.version.body).toBe("Our Moisturiser is a miracle.");
    expect(v2.body.run.status).toBe("COMPLETED");

    const statuses = await prisma.finding.findMany({ where: { contentItemId: id }, orderBy: { createdAt: "asc" } });
    expect(statuses.map((f) => [f.fingerprint, f.status])).toEqual([
      ["fp-cream", "CLOSED"],
      ["fp-miracle", "SUPERSEDED"],
      ["fp-miracle", "DISPUTED"],
    ]);

    await creator.post(`${base}/content/${id}/transitions`, { action: "RESOLVE" }).expect(200);

    // Separation of duties and reasons for decisions.
    await creator.post(`${base}/content/${id}/transitions`, { action: "APPROVE" }).expect(403);
    await reviewer.post(`${base}/content/${id}/transitions`, { action: "APPROVE" }).expect(403);
    await reviewer.post(`${base}/content/${id}/transitions`, { action: "REQUEST_CHANGES" }).expect(400);
    await reviewer.post(`${base}/content/${id}/comments`, { body: "Looks good to me.", findingId: miracle.id }).expect(201);
    const approved = await approver.post(`${base}/content/${id}/transitions`, { action: "APPROVE", note: "Ship it" }).expect(200);
    expect(approved.body.state).toBe("APPROVED");
    await creator.post(`${base}/content/${id}/versions`, { body: "Edited after approval" }).expect(409);

    detail = await creator.get(`${base}/content/${id}`).expect(200);
    expect(detail.body.events.map((e: { action: string }) => e.action)).toEqual(["SUBMIT", "RESOLVE", "APPROVE"]);
    expect(detail.body.closedFindingCount).toBe(1);

    const audit = await creator.get(`${base}/content/${id}/audit`).expect(200);
    const actions = audit.body.entries.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining([
      "content.created", "content.submit", "analysis.completed", "finding.accept", "finding.dispute",
      "content.version_created", "content.resolve", "comment.added", "content.approve",
    ]));
  });

  it("keeps organisations isolated", async () => {
    const base = `/api/orgs/${orgId}`;
    const item = await creator.post(`${base}/content`, { title: "Private", channel: "website", body: "Secret plan" }).expect(201);
    const id = item.body.item.id;

    // Not a member: the organisation looks like it does not exist.
    await outsider.get(`${base}/content/${id}`).expect(404);
    await outsider.get(`${base}/rules`).expect(404);
    // A member of another org using a real id through their own org path also gets 404.
    await outsider.get(`/api/orgs/${otherOrgId}/content/${id}`).expect(404);
    await outsider.post(`/api/orgs/${otherOrgId}/content/${id}/comments`, { body: "hi" }).expect(404);
    const ruleId = (await admin.get(`${base}/rules`).expect(200)).body.rules[0].id;
    await outsider.patch(`/api/orgs/${otherOrgId}/rules/${ruleId}`, { active: false }).expect(404);
    const other = await outsider.get(`/api/orgs/${otherOrgId}/content`).expect(200);
    expect(other.body.items).toEqual([]);
  });

  it("records a failed check clearly and allows a retry", async () => {
    const base = `/api/orgs/${orgId}`;
    const item = await creator.post(`${base}/content`, { title: "Retry", channel: "website", body: "Our Cream." }).expect(201);
    const id = item.body.item.id;
    (analysis as FakeAnalysis).down = true;
    const submitted = await creator.post(`${base}/content/${id}/transitions`, { action: "SUBMIT" }).expect(200);
    expect(submitted.body.run.status).toBe("FAILED");
    expect(submitted.body.run.error).toMatch(/unreachable/);
    await creator.post(`${base}/content/${id}/transitions`, { action: "RESOLVE" }).expect(409);
    (analysis as FakeAnalysis).down = false;
    const retry = await creator.post(`${base}/content/${id}/analyze`).expect(200);
    expect(retry.body.run.status).toBe("COMPLETED");
  });

  it("accepts document uploads and rejects files whose contents do not match", async () => {
    const base = `/api/orgs/${orgId}`;
    const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("rest of zip")]);
    const ok = await creator.raw().post(`${base}/content`).set(creator.auth)
      .field("title", "From Word").field("channel", "website")
      .attach("file", docx, { filename: "draft.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })
      .expect(201);
    expect(ok.body.version.sourceFileName).toBe("draft.docx");
    await creator.raw().post(`${base}/content`).set(creator.auth)
      .field("title", "Fake PDF").field("channel", "website")
      .attach("file", Buffer.from("hello"), { filename: "x.pdf", contentType: "application/pdf" })
      .expect(400);
  });
});
