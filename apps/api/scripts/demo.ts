// Walks the seeded caption through the whole workflow against a running API and analysis service:
// submit → findings → accept fixes / dispute → new version re-checked → resolve → approve.
// Usage: npm run db:seed && npm run demo -w apps/api
import "dotenv/config";
import { SignJWT } from "jose";

const API = process.env.DEMO_API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
const ORG = "org_northfern";
const ids: Record<string, string> = {
  creator: "00000000-0000-4000-8000-000000000002",
  approver: "00000000-0000-4000-8000-000000000004",
};

async function token(who: string) {
  return new SignJWT({ email: `${who}@northfern.test` })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(ids[who]!)
    .setAudience("authenticated")
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.AUTH_JWT_SECRET!));
}

async function call(who: string, method: string, path: string, body?: object) {
  const res = await fetch(`${API}/api/orgs/${ORG}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token(who)}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

interface Finding {
  id: string; kind: string; quote: string; sourceCode: string | null; sourceClauseCode: string | null;
  origins: string[]; explanation: string; fixReplacement: string | null; status: string;
}

function show(findings: Finding[]) {
  for (const f of findings) {
    const cite = f.sourceClauseCode && f.sourceClauseCode !== f.sourceCode ? `${f.sourceCode} → ${f.sourceClauseCode}` : f.sourceCode ?? "none";
    console.log(`  [${f.kind}] "${f.quote}" (${f.origins.join("+")}, cites ${cite}) ${f.fixReplacement !== null ? `fix: "${f.fixReplacement}"` : ""}`);
    console.log(`      ${f.explanation}`);
  }
}

const { items } = await call("creator", "GET", "/content?state=DRAFT");
const item = items.find((i: { title: string }) => i.title === "Winter launch caption");
if (!item) throw new Error("Seeded caption not found; run npm run db:seed first");

console.log(`\n1. Creator submits "${item.title}"`);
const submitted = await call("creator", "POST", `/content/${item.id}/transitions`, { action: "SUBMIT" });
console.log(`   state ${submitted.state}; AI ${submitted.run.aiStatus}${submitted.run.aiError ? ` (${submitted.run.aiError})` : ""}`);
let detail = await call("creator", "GET", `/content/${item.id}`);
console.log(`   draft: ${detail.versions[0].body}`);
show(detail.latestRun.findings);

console.log("\n2. Creator accepts every fix, disputes violations without one");
for (const f of detail.latestRun.findings as Finding[]) {
  if (f.kind !== "violation") continue;
  if (f.fixReplacement !== null) await call("creator", "POST", `/findings/${f.id}/responses`, { action: "ACCEPT" });
  else await call("creator", "POST", `/findings/${f.id}/responses`, { action: "EDIT", editedText: "a comfort for dry skin" });
}

try {
  const v2 = await call("creator", "POST", `/content/${item.id}/versions`, { applyResponses: true });
  console.log(`   new version ${v2.version.number}: ${v2.version.body}`);
} catch (err) {
  // Two fixes on the same words (e.g. "MIRACLE" is both a banned term and in capitals) conflict.
  console.log(`   ${(err as Error).message.split("→ ")[1]}`);
  console.log("   Falling back to the creator rewriting the caption by hand.");
  const v2 = await call("creator", "POST", `/content/${item.id}/versions`, {
    body: "Our Calm Barrier Moisturiser keeps dry skin comfortable, now just ₹549!",
  });
  console.log(`   new version ${v2.version.number}: ${v2.version.body}`);
}

detail = await call("creator", "GET", `/content/${item.id}`);
console.log(`   re-check: ${detail.latestRun.findings.length} findings, ${detail.closedFindingCount} closed by the new version`);
show(detail.latestRun.findings);
for (const f of detail.latestRun.findings as Finding[]) {
  if (f.kind === "violation" && f.status === "OPEN") {
    await call("creator", "POST", `/findings/${f.id}/responses`, { action: "DISPUTE", reason: "Approved wording for this campaign" });
  }
}

console.log("\n3. Creator sends it to review; approver approves");
await call("creator", "POST", `/content/${item.id}/transitions`, { action: "RESOLVE" });
const approved = await call("approver", "POST", `/content/${item.id}/transitions`, { action: "APPROVE", note: "Good to publish" });
console.log(`   state ${approved.state}`);

const audit = await call("creator", "GET", `/content/${item.id}/audit`);
console.log(`\n4. Audit trail (${audit.entries.length} entries)`);
for (const e of audit.entries) console.log(`   ${e.createdAt}  ${e.action}`);
