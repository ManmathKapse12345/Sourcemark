// Seeds the demo organisation (fictional Northfern Skincare) from eval/brand_kit.json, the same
// brand kit the evaluation uses, plus one user per role and a second organisation for isolation demos.
// Re-running the seed resets both demo organisations.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient, type FactKind, type Role, type RuleType, type Severity } from "@prisma/client";
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
      ],
    });
    await tx.asset.create({
      data: { orgId: ORG, name: "Northfern palette", type: "palette", colors: ["#1F4D3A", "#F4EFE6", "#C9A66B", "#2B2B2B"] },
    });

    const creator = `mem_creator_${ORG}`;
    const item = await tx.contentItem.create({
      data: { orgId: ORG, title: "Winter launch caption", channel: "instagram", authorId: creator },
    });
    await tx.contentVersion.create({
      data: { orgId: ORG, contentItemId: item.id, number: 1, body: "Our Calm Barrier Cream is a MIRACLE, now just ₹499!!", createdById: creator },
    });
    await tx.auditLog.create({ data: { orgId: ORG, actorId: null, action: "seed.loaded", entityType: "Organisation", entityId: ORG } });
  }, { maxWait: 20_000, timeout: 120_000 }); // a remote database (e.g. Supabase) needs far more than the 5 s default

  // Embeddings need the analysis service with a Gemini key; without them, AI review uses all clauses.
  const embedded = await embedClauses().catch((err: Error) => `skipped (${err.message})`);
  console.log(`Seeded ${ORG}: ${kit.guideline.clauses.length} clauses, ${kit.rules.length} rules, ${kit.facts.length} facts; embeddings ${embedded}`);
  console.log("Users:", users.map((u) => u.email).join(", "));
  console.log("Get a token with: npm run token -- creator@northfern.test");
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
