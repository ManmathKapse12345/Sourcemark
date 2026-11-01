import { describe, expect, it } from "vitest";
import { computeHealth, type HealthFinding } from "../src/health/guidelineHealth.js";

const AUTHOR = "mem_writer";
const REVIEWER = "mem_reviewer";
let seq = 0;

// One finding row. `item` is the content it belongs to; the same item+fingerprint on a later row
// is the same problem found again on a new version.
function finding(item: string, code: string, opts: Partial<HealthFinding> & { response?: [string, string, string?] } = {}): HealthFinding {
  const t = new Date(Date.UTC(2026, 9, 1, 0, 0, seq++));
  const [memberId, action, reason] = opts.response ?? [];
  return {
    id: `f${seq}`,
    contentItemId: item,
    fingerprint: `${code}:${item}`,
    sourceType: code.startsWith("G-") ? "clause" : "rule",
    sourceCode: code.startsWith("G-") ? code : `R-${code}`,
    sourceClauseCode: code.startsWith("G-") ? code : null,
    origins: ["rule"],
    quote: "flagged words",
    explanation: "Explanation.",
    status: action === "DISPUTE" ? "DISPUTED" : "OPEN",
    createdAt: t,
    item: { title: `Post ${item}`, state: "IN_REVIEW", authorId: AUTHOR },
    responses: memberId ? [{ memberId, action: action!, reason: reason ?? null, createdAt: t }] : [],
    ...opts,
  };
}

// A rule citing a clause, as most findings do.
function ruleFinding(item: string, clause: string, response?: [string, string, string?]) {
  return finding(item, clause, { sourceType: "rule", sourceCode: "R-9", sourceClauseCode: clause, response });
}

describe("guideline health", () => {
  it("ranks a planted unclear clause first and explains why", () => {
    const rows: HealthFinding[] = [];
    // G-1.1: clear, people accept the fixes (10 problems, 1 dispute).
    for (let i = 0; i < 10; i++) rows.push(finding(`a${i}`, "G-1.1", { response: i === 0 ? [AUTHOR, "DISPUTE", "Fine here"] : [AUTHOR, "ACCEPT"] }));
    // G-3.5: unclear, writers dispute and a reviewer overrides (6 of 8 challenged).
    for (let i = 0; i < 8; i++) {
      const response: [string, string, string] | undefined =
        i < 4 ? [AUTHOR, "DISPUTE", "Saying skin is dry is not fear-based"] : i < 6 ? [REVIEWER, "DISPUTE", "Factual, allowed"] : [AUTHOR, "ACCEPT", ""];
      rows.push(ruleFinding(`b${i}`, "G-3.5", response));
    }
    // G-2.1: a few disputes but too few decisions to judge.
    for (let i = 0; i < 3; i++) rows.push(finding(`c${i}`, "G-2.1", { response: [AUTHOR, "DISPUTE", "Short name is fine"] }));

    const report = computeHealth(rows);
    const [top, ...rest] = report.entries;
    expect(top!.code).toBe("G-3.5");
    expect(top).toMatchObject({ flagged: true, decisions: 8, disputed: 4, overridden: 2, accepted: 2, ruleCodes: ["R-9"] });
    expect(top!.why).toContain("6 of 8 decisions");
    expect(top!.cases[0]!.outcome).toBe("overridden"); // the strongest signal is shown first
    expect(rest.find((e) => e.code === "G-2.1")!.flagged).toBe(false); // 3 decisions < minimum
    expect(rest.find((e) => e.code === "G-1.1")!.flagged).toBe(false);
  });

  it("counts a problem once across versions and copied disputes", () => {
    const first = finding("x", "G-3.1", { response: [AUTHOR, "DISPUTE", "It is a figure of speech"] });
    // The next version found it again; runAnalysis copies the dispute onto the new row.
    const second = finding("x", "G-3.1", { response: [AUTHOR, "DISPUTE", "It is a figure of speech"], createdAt: new Date(first.createdAt.getTime() + 1000) });
    const [entry] = computeHealth([first, second]).entries;
    expect(entry).toMatchObject({ decisions: 1, disputed: 1 });
  });

  it("treats a fix in a new version as accepted and approval over a dispute as an override", () => {
    const fixed = finding("p", "G-1.3", { status: "CLOSED" });
    const approvedOver = finding("q", "G-1.3", { response: [AUTHOR, "DISPUTE", "Brand voice"] });
    approvedOver.item = { ...approvedOver.item, state: "APPROVED" };
    const unanswered = finding("r", "G-1.3");
    const [entry] = computeHealth([fixed, approvedOver, unanswered]).entries;
    expect(entry).toMatchObject({ decisions: 2, accepted: 1, overridden: 1 }); // the open one is not a decision yet
  });

  it("leaves facts out: they are not guidelines", () => {
    const fact = finding("f", "F-2", { sourceType: "fact", sourceCode: "F-2", sourceClauseCode: null, response: [AUTHOR, "DISPUTE", "old price"] });
    expect(computeHealth([fact]).entries).toEqual([]);
  });
});
