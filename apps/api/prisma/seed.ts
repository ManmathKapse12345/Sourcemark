// Seeds the demo organisation (fictional Northfern Skincare) from eval/brand_kit.json, the same
// brand kit the evaluation uses, plus one user per role and a second organisation for isolation demos.
// Re-running the seed resets both demo organisations.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient, type FactKind, type Prisma, type Role, type RuleType, type Severity } from "@prisma/client";
import { createAnalysisClient } from "../src/analysis/client.js";

const prisma = new PrismaClient();
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

interface Kit {
  guideline: { title: string; clauses: { code: string; heading: string | null; text: string }[] };
  rules: { code: string; type: RuleType; severity: Severity; clause_code: string | null; message: string; config: object }[];
  facts: {
    code: string; subject: string; aliases: string[]; attribute: string; kind: FactKind; value: string;
    unit: string | null; valid_from: string; valid_until: string | null; source: string | null;
  }[];
}
const kit: Kit = JSON.parse(readFileSync(join(root, "eval", "brand_kit.json"), "utf8"));

const ORG = "org_northfern";
const OTHER_ORG = "org_other";
const users: { id: string; email: string; name: string; roles: Role[]; org: string }[] = [
  { id: "00000000-0000-4000-8000-000000000001", email: "admin@northfern.test", name: "Asha (Admin)", roles: ["ADMIN"], org: ORG },
  { id: "00000000-0000-4000-8000-000000000002", email: "creator@northfern.test", name: "Chirag (Creator)", roles: ["CREATOR"], org: ORG },
  { id: "00000000-0000-4000-8000-000000000003", email: "reviewer@northfern.test", name: "Ritu (Reviewer)", roles: ["REVIEWER"], org: ORG },
  { id: "00000000-0000-4000-8000-000000000004", email: "approver@northfern.test", name: "Arjun (Approver)", roles: ["APPROVER"], org: ORG },
  { id: "00000000-0000-4000-8000-000000000005", email: "admin@other.test", name: "Olivia (Other org)", roles: ["ADMIN", "CREATOR"], org: OTHER_ORG },
];

const date = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const max = (codes: string[], prefix: string) =>
  Math.max(0, ...codes.map((c) => Number(c.replace(prefix, ""))).filter(Number.isFinite));

async function main() {
  await prisma.$transaction(async (tx) => {
    for (const orgId of [ORG, OTHER_ORG]) {
      for (const model of ["finding", "analysisRun", "contentVersion", "comment", "approvalEvent", "contentItem",
        "clause", "guidelineVersion", "guideline", "rule", "fact", "asset", "auditLog", "orgCounter", "member"] as const) {
        await (tx[model] as unknown as { deleteMany: (a: object) => Promise<unknown> }).deleteMany({ where: { orgId } });
      }
      await tx.organisation.deleteMany({ where: { id: orgId } });
    }

    await tx.organisation.create({ data: { id: ORG, name: "Northfern Skincare (demo)" } });
    await tx.organisation.create({ data: { id: OTHER_ORG, name: "Other Org (isolation demo)" } });
    for (const u of users) {
      await tx.user.upsert({ where: { id: u.id }, create: { id: u.id, email: u.email, name: u.name }, update: { email: u.email, name: u.name } });
      await tx.member.create({ data: { id: `mem_${u.email.split("@")[0]}_${u.org}`, orgId: u.org, userId: u.id, roles: u.roles } });
    }
    const adminMember = `mem_admin_${ORG}`;

    const g = await tx.guideline.create({ data: { orgId: ORG, title: kit.guideline.title, prefix: "G" } });
    const v = await tx.guidelineVersion.create({
      data: {
        orgId: ORG, guidelineId: g.id, number: 1, status: "PUBLISHED", publishedAt: new Date(),
        sourceFileName: "northfern-guidelines.md", rawText: kit.guideline.clauses.map((c) => c.text).join("\n\n"),
        createdById: adminMember,
      },
    });
    await tx.clause.createMany({
      data: kit.guideline.clauses.map((c, i) => ({ orgId: ORG, versionId: v.id, code: c.code, heading: c.heading, text: c.text, position: i })),
    });

    await tx.rule.createMany({
      data: kit.rules.map((r) => ({
        orgId: ORG, code: r.code, type: r.type, severity: r.severity, clauseCode: r.clause_code, message: r.message, config: r.config,
      })),
    });
    await tx.fact.createMany({
      data: kit.facts.map((f) => ({
        orgId: ORG, code: f.code, subject: f.subject, aliases: f.aliases, attribute: f.attribute, kind: f.kind, value: f.value,
        unit: f.unit, validFrom: date(f.valid_from), validUntil: f.valid_until ? date(f.valid_until) : null, source: f.source,
      })),
    });
    await tx.orgCounter.createMany({
      data: [
        { orgId: ORG, kind: "rule", value: max(kit.rules.map((r) => r.code), "R-") },
        { orgId: ORG, kind: "fact", value: max(kit.facts.map((f) => f.code), "F-") },
        { orgId: ORG, kind: "guideline", value: 1 },
        { orgId: ORG, kind: "asset", value: 2 },
      ],
    });
    await tx.asset.create({
      data: { orgId: ORG, code: "A-1", name: "Northfern palette", type: "palette", colors: ["#1F4D3A", "#F4EFE6", "#C9A66B", "#2B2B2B"] },
    });
    // The approved logo file, so image review can check logo use (eval/images/make_images.py draws it).
    await tx.asset.create({
      data: { orgId: ORG, code: "A-2", name: "Northfern logo", type: "logo", imageMime: "image/png",
              imageData: new Uint8Array(readFileSync(join(root, "eval", "images", "northfern-logo.png"))) },
    });

    const creator = `mem_creator_${ORG}`;
    const item = await tx.contentItem.create({
      data: { orgId: ORG, title: "Winter launch caption", channel: "instagram", authorId: creator },
    });
    await tx.contentVersion.create({
      data: { orgId: ORG, contentItemId: item.id, number: 1, body: "Our Calm Barrier Cream is a MIRACLE, now just ₹499!!", createdById: creator },
    });
    // An image post to try image review on: the poster shows last season's price.
    const poster = await tx.contentItem.create({
      data: { orgId: ORG, title: "Festive poster", channel: "instagram", kind: "image", authorId: creator },
    });
    await tx.contentVersion.create({
      data: { orgId: ORG, contentItemId: poster.id, number: 1, body: "", altText: null, createdById: creator,
              sourceFileName: "festive-poster.png", imageMime: "image/png",
              imageData: new Uint8Array(readFileSync(join(root, "eval", "images", "i06.png"))) },
    });
    await seedReviewHistory(tx);
    await tx.auditLog.create({ data: { orgId: ORG, actorId: null, action: "seed.loaded", entityType: "Organisation", entityId: ORG } });
  }, { maxWait: 20_000, timeout: 120_000 }); // a remote database (e.g. Supabase) needs far more than the 5 s default

  // Embeddings need the analysis service with a Gemini key; without them, AI review uses all clauses.
  const embedded = await embedClauses().catch((err: Error) => `skipped (${err.message})`);
  console.log(`Seeded ${ORG}: ${kit.guideline.clauses.length} clauses, ${kit.rules.length} rules, ${kit.facts.length} facts; embeddings ${embedded}`);
  console.log("Users:", users.map((u) => u.email).join(", "));
  console.log("Get a token with: npm run token -- creator@northfern.test");
}

// Past reviews, so guideline health has something to show. G-3.5 (fear-based language) is planted as
// the unclear clause: writers keep disputing it for plain descriptions of dry skin, and reviewers agree.
// The other clauses are mostly accepted.
type Outcome = "accept" | "dispute" | "override";
interface PastFinding { source: string; quote: string; outcome: Outcome; reason?: string }
const HISTORY: { title: string; body: string; state: "IN_REVIEW" | "APPROVED"; findings: PastFinding[] }[] = [
  { title: "Winter care reel script", state: "APPROVED", body: "Dry, damaged skin? Calm Barrier Moisturiser keeps it comfortable for up to 24 hours.",
    findings: [{ source: "G-3.5", quote: "Dry, damaged skin", outcome: "dispute", reason: "This names the skin type the product is for. It is not fear-based." }] },
  { title: "Dermatology Q&A email", state: "APPROVED", body: "Cold air leaves skin rough and tight. Gentle Oat Cleanser cleans without stripping it.",
    findings: [{ source: "G-3.5", quote: "leaves skin rough and tight", outcome: "override", reason: "Factual description of winter skin, allowed." }] },
  { title: "Monsoon tips post", state: "APPROVED", body: "Humidity can make skin feel dull and congested. Try a lighter routine this month!",
    findings: [{ source: "G-3.5", quote: "dull and congested", outcome: "dispute", reason: "Describing how skin feels is not fear. The clause is about insults like ugly." }] },
  { title: "Sunscreen explainer", state: "IN_REVIEW", body: "UV damage builds up every day. Dew Shield SPF 50 Sunscreen helps protect your skin.",
    findings: [{ source: "G-3.5", quote: "UV damage builds up every day", outcome: "dispute", reason: "This is a sun-safety fact, not a scare tactic." }] },
  { title: "Barrier repair carousel", state: "APPROVED", body: "A weakened skin barrier lets moisture escape. Calm Barrier Moisturiser keeps dry skin comfortable.",
    findings: [{ source: "G-3.5", quote: "A weakened skin barrier", outcome: "override", reason: "Plain description of the problem the product solves." }] },
  { title: "Founder story", state: "APPROVED", body: "Meera started Northfern after years of embarrassing breakouts. Now she makes gentle skincare.",
    findings: [{ source: "G-3.5", quote: "embarrassing breakouts", outcome: "accept" }] },
  { title: "Festive offer caption", state: "APPROVED", body: "Our Calm Barrier Cream is a miracle for dry skin!!",
    findings: [
      { source: "R-4", quote: "Calm Barrier Cream", outcome: "accept" },
      { source: "R-1", quote: "miracle", outcome: "accept" },
      { source: "R-9", quote: "!!", outcome: "accept" },
    ] },
  { title: "Oat cleanser launch", state: "APPROVED", body: "Gentle Oats Cleanser is magic for sensitive skin!!",
    findings: [
      { source: "R-7", quote: "Gentle Oats Cleanser", outcome: "accept" },
      { source: "R-1", quote: "magic", outcome: "accept" },
      { source: "R-9", quote: "!!", outcome: "accept" },
    ] },
  { title: "Sunscreen reel caption", state: "APPROVED", body: "Dew Shield SPF50 is the cure for summer skin!!",
    findings: [
      { source: "R-6", quote: "Dew Shield SPF50", outcome: "accept" },
      { source: "R-1", quote: "cure", outcome: "accept" },
      { source: "R-9", quote: "!!", outcome: "accept" },
    ] },
  { title: "Influencer brief", state: "APPROVED", body: "Calm Barrier Lotion feels like magic on dry patches.",
    findings: [
      { source: "R-4", quote: "Calm Barrier Lotion", outcome: "accept" },
      { source: "R-1", quote: "magic", outcome: "dispute", reason: "Used as a figure of speech in a quote from a customer." },
    ] },
  { title: "Gift guide blurb", state: "APPROVED", body: "Calm Barrier Moisturizer is a miracles-in-a-jar gift.",
    findings: [
      { source: "R-4", quote: "Calm Barrier Moisturizer", outcome: "accept" },
      { source: "R-1", quote: "miracles", outcome: "accept" },
    ] },
  { title: "Newsletter intro", state: "APPROVED", body: "Dewshield Sunscreen is back in stock!!",
    findings: [
      { source: "R-6", quote: "Dewshield Sunscreen", outcome: "accept" },
      { source: "R-9", quote: "!!", outcome: "accept" },
    ] },
];

async function seedReviewHistory(tx: Prisma.TransactionClient) {
  const creator = `mem_creator_${ORG}`;
  const reviewer = `mem_reviewer_${ORG}`;
  const rules = new Map(kit.rules.map((r) => [r.code, r]));
  const clauses = new Map(kit.guideline.clauses.map((c) => [c.code, c]));
  for (const [i, h] of HISTORY.entries()) {
    const at = new Date(Date.now() - (HISTORY.length - i + 2) * 86_400_000);
    const item = await tx.contentItem.create({
      data: { orgId: ORG, title: h.title, channel: "instagram", state: h.state, authorId: creator, createdAt: at, updatedAt: at },
    });
    const version = await tx.contentVersion.create({
      data: { orgId: ORG, contentItemId: item.id, number: 1, body: h.body, createdById: creator, createdAt: at },
    });
    const run = await tx.analysisRun.create({
      data: { orgId: ORG, contentItemId: item.id, versionId: version.id, status: "COMPLETED", aiStatus: "ok", createdAt: at, completedAt: at },
    });
    for (const [j, f] of h.findings.entries()) {
      const rule = rules.get(f.source);
      const clause = clauses.get(rule ? rule.clause_code ?? "" : f.source);
      const start = h.body.indexOf(f.quote);
      const finding = await tx.finding.create({
        data: {
          orgId: ORG, runId: run.id, contentItemId: item.id, versionId: version.id, fingerprint: `history-${i}-${j}`,
          kind: "violation", category: rule ? (rule.type === "terminology" ? "terminology" : "claim") : "tone",
          severity: rule?.severity ?? "medium", origins: rule ? ["rule"] : ["ai"],
          spanStart: start, spanEnd: start + f.quote.length, quote: f.quote,
          explanation: rule ? `"${f.quote}" breaks ${rule.code}. ${rule.message}` : `"${f.quote}" reads as fear-based language about skin.`,
          sourceType: rule ? "rule" : "clause", sourceCode: f.source, sourceClauseCode: clause?.code ?? null, sourceText: clause?.text ?? rule?.message ?? null,
          confidence: rule ? 1 : 0.8, status: f.outcome === "accept" ? "OPEN" : "DISPUTED", createdAt: at,
        },
      });
      const respond = (memberId: string, action: "ACCEPT" | "DISPUTE", reason: string | null) =>
        tx.findingResponse.create({ data: { orgId: ORG, findingId: finding.id, memberId, action, reason, createdAt: at } });
      if (f.outcome === "accept") await respond(creator, "ACCEPT", null);
      if (f.outcome === "dispute" || f.outcome === "override") await respond(creator, "DISPUTE", f.reason ?? null);
      if (f.outcome === "override") await respond(reviewer, "DISPUTE", f.reason ?? null);
    }
  }
}

async function embedClauses(): Promise<string> {
  if (!process.env.ANALYSIS_TOKEN) return "skipped (ANALYSIS_TOKEN not set)";
  const client = createAnalysisClient({
    baseUrl: process.env.ANALYSIS_URL ?? "http://localhost:8000",
    token: process.env.ANALYSIS_TOKEN,
    timeoutMs: 60_000,
  });
  const clauses = await prisma.clause.findMany({ where: { orgId: ORG }, orderBy: { position: "asc" } });
  const result = await client.embed({ texts: clauses.map((c) => (c.heading ? `${c.heading}: ${c.text}` : c.text)), task: "document" });
  if (!result) return "skipped (no embedding model configured)";
  for (const [i, c] of clauses.entries()) {
    const vector = `[${result.vectors[i]!.join(",")}]`;
    await prisma.$executeRaw`UPDATE "Clause" SET "embedding" = ${vector}::vector, "embeddingModel" = ${result.model} WHERE "id" = ${c.id}`;
  }
  return `stored (${result.model})`;
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
