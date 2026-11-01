import { beforeAll, describe, expect, it } from "vitest";
import { makeApp, newUser, signIn } from "./helpers.js";

type Client = Awaited<ReturnType<typeof signIn>>;

describe("guideline health routes", () => {
  const { app, analysis } = makeApp();
  let admin: Client, creator: Client, outsider: Client;
  let base: string;

  beforeAll(async () => {
    const users = { admin: newUser("admin"), creator: newUser("creator"), outsider: newUser("outsider") };
    admin = await signIn(app, users.admin);
    creator = await signIn(app, users.creator);
    outsider = await signIn(app, users.outsider);
    const orgId = (await admin.post("/api/orgs", { name: "Health Org" }).expect(201)).body.org.id;
    base = `/api/orgs/${orgId}`;
    await admin.post(`${base}/members`, { email: users.creator.email, roles: ["CREATOR"] }).expect(201);

    // The fake extractor returns clause G-1.1, which the fake checks cite.
    const g = await admin.post(`${base}/guidelines`, { title: "Brand guide", text: "1.1 Use the approved product name." }).expect(201);
    await admin.post(`${base}/guideline-versions/${g.body.version.id}/publish`).expect(200);

    // Six posts: the writer accepts every "Cream" fix and disputes "miracle" on five of them.
    for (let i = 0; i < 6; i++) {
      const id = (await creator.post(`${base}/content`, { title: `Post ${i}`, channel: "instagram", body: "Calm Barrier Cream is a miracle." }).expect(201)).body.item.id;
      await creator.post(`${base}/content/${id}/transitions`, { action: "SUBMIT" }).expect(200);
      const findings = (await creator.get(`${base}/content/${id}`).expect(200)).body.latestRun.findings as { id: string; fingerprint: string }[];
      await creator.post(`${base}/findings/${findings.find((f) => f.fingerprint === "fp-cream")!.id}/responses`, { action: "ACCEPT" }).expect(201);
      if (i < 5) {
        await creator.post(`${base}/findings/${findings.find((f) => f.fingerprint === "fp-miracle")!.id}/responses`,
          { action: "DISPUTE", reason: `It is a figure of speech (${i})` }).expect(201);
      }
    }
  });

  it("is for admins of the organisation only", async () => {
    await creator.get(`${base}/guideline-health`).expect(403);
    await outsider.get(`${base}/guideline-health`).expect(404);
  });

  it("reports decisions per clause with the current wording and the cases", async () => {
    const res = await admin.get(`${base}/guideline-health`).expect(200);
    const [entry] = res.body.entries;
    expect(entry).toMatchObject({
      code: "G-1.1", kind: "clause", ruleCodes: ["R-1", "R-4"], decisions: 11, accepted: 6, disputed: 5,
      text: "Use the approved product name.", canReword: true,
    });
    expect(entry.cases[0]).toMatchObject({ outcome: "disputed", quote: "miracle" });
    expect(entry.cases[0].reason).toMatch(/figure of speech/);
  });

  it("suggests a clearer wording from the disputed cases and saves it as a draft version", async () => {
    const suggestion = await admin.post(`${base}/guideline-health/G-1.1/suggest`).expect(200);
    expect(analysis.rewordCalls.at(-1)!.cases).toHaveLength(5); // only the disputed cases
    expect(suggestion.body.suggestion).toContain("Factual descriptions are allowed.");

    const applied = await admin.post(`${base}/guideline-health/G-1.1/apply`, { text: suggestion.body.suggestion }).expect(201);
    expect(applied.body.version).toMatchObject({ number: 2, status: "DRAFT" });
    expect(applied.body.clauses).toEqual([{ code: "G-1.1", heading: "Names", text: suggestion.body.suggestion }]);

    // One draft at a time, as with uploaded versions.
    await admin.post(`${base}/guideline-health/G-1.1/apply`, { text: "Another wording." }).expect(409);
    await admin.post(`${base}/guideline-health/G-9.9/apply`, { text: "Nope." }).expect(404);
  });
});
