// Guideline health: which guideline clauses (and rules without a clause) people keep pushing back on.
//
// Every problem a check raised is counted once per content item, however many versions repeated it
// (findings are matched across versions by fingerprint). Each problem gets one outcome from how people
// answered it:
//   overridden  a reviewer or approver disputed it, or the content was approved while it stood disputed
//   disputed    the writer disputed it ("This is wrong") and nobody overrode the dispute
//   edited      the writer wrote their own fix instead of the suggested one
//   accepted    the writer used the fix, or a later version stopped producing it
// "Challenged" = overridden or disputed. A clause is flagged only after enough decisions, when its
// challenge rate is well above the organisation's average, and the cases are always shown so an admin
// can tell an unclear clause from a careless reviewer.

export const MIN_DECISIONS = 5;
export const MIN_CHALLENGED = 3;
export const MIN_RATE = 0.3;
export const ABOVE_AVERAGE = 1.5;
const MAX_CASES = 12;

export type Outcome = "overridden" | "disputed" | "edited" | "accepted";

export interface HealthFinding {
  id: string;
  contentItemId: string;
  fingerprint: string;
  sourceType: string | null;
  sourceCode: string | null;
  sourceClauseCode: string | null;
  origins: string[];
  quote: string;
  explanation: string;
  status: string;
  createdAt: Date;
  item: { title: string; state: string; authorId: string };
  responses: { memberId: string; action: string; reason: string | null; createdAt: Date }[];
}

export interface HealthCase {
  findingId: string;
  contentItemId: string;
  title: string;
  quote: string;
  explanation: string;
  outcome: Outcome;
  reason: string | null;
  by: string | null;
  at: string;
}

export interface HealthEntry {
  code: string; // the clause code, or the rule code for a rule without a clause
  kind: "clause" | "rule";
  ruleCodes: string[];
  foundBy: { rule: number; ai: number };
  decisions: number;
  accepted: number;
  edited: number;
  disputed: number;
  overridden: number;
  challengeRate: number;
  flagged: boolean;
  why: string | null;
  cases: HealthCase[];
}

export interface HealthReport {
  orgAverage: number;
  thresholds: { minDecisions: number; minChallenged: number; minRate: number; aboveAverage: number };
  entries: HealthEntry[];
}

interface Problem {
  latest: HealthFinding;
  outcome: Outcome | null; // null: nobody has answered it yet and it is still open
  reason: string | null;
  by: string | null;
  at: Date;
}

function outcomeOf(rows: HealthFinding[]): Omit<Problem, "latest"> {
  const latest = rows.at(-1)!;
  const authorId = latest.item.authorId;
  // Disputes are copied onto later versions of a finding, so the same response can appear more than once.
  const responses = rows.flatMap((r) => r.responses).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const byOthers = responses.filter((r) => r.memberId !== authorId && r.action === "DISPUTE");
  if (byOthers.length) {
    const r = byOthers.at(-1)!;
    return { outcome: "overridden", reason: r.reason, by: r.memberId, at: r.createdAt };
  }
  const own = responses.filter((r) => r.memberId === authorId);
  const last = own.at(-1);
  if (last?.action === "DISPUTE" || latest.status === "DISPUTED") {
    const dispute = [...own].reverse().find((r) => r.action === "DISPUTE");
    const approvedOverIt = latest.item.state === "APPROVED" && latest.status === "DISPUTED";
    return {
      outcome: approvedOverIt ? "overridden" : "disputed",
      reason: dispute?.reason ?? null,
      by: dispute?.memberId ?? null,
      at: dispute?.createdAt ?? latest.createdAt,
    };
  }
  if (last?.action === "EDIT") return { outcome: "edited", reason: null, by: last.memberId, at: last.createdAt };
  if (last?.action === "ACCEPT" || latest.status === "CLOSED") {
    return { outcome: "accepted", reason: null, by: last?.memberId ?? null, at: last?.createdAt ?? latest.createdAt };
  }
  return { outcome: null, reason: null, by: null, at: latest.createdAt };
}

// The clause a finding ultimately rests on: a rule's clause, or the cited clause. Facts are not
// guidelines, so findings citing a fact are left out.
function groupKey(f: HealthFinding): { code: string; kind: "clause" | "rule" } | null {
  if (f.sourceType === "fact" || !f.sourceCode) return null;
  if (f.sourceClauseCode) return { code: f.sourceClauseCode, kind: "clause" };
  return f.sourceType === "clause" ? { code: f.sourceCode, kind: "clause" } : { code: f.sourceCode, kind: "rule" };
}

export function computeHealth(findings: HealthFinding[]): HealthReport {
  const byProblem = new Map<string, HealthFinding[]>();
  for (const f of [...findings].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (!groupKey(f)) continue;
    const key = `${f.contentItemId}|${f.fingerprint}`;
    byProblem.set(key, [...(byProblem.get(key) ?? []), f]);
  }

  const groups = new Map<string, { kind: "clause" | "rule"; problems: Problem[] }>();
  for (const rows of byProblem.values()) {
    const latest = rows.at(-1)!;
    const key = groupKey(latest)!;
    const g = groups.get(key.code) ?? { kind: key.kind, problems: [] };
    g.problems.push({ latest, ...outcomeOf(rows) });
    groups.set(key.code, g);
  }

  const entries: HealthEntry[] = [...groups.entries()].map(([code, g]) => {
    const decided = g.problems.filter((p) => p.outcome !== null);
    const count = (o: Outcome) => decided.filter((p) => p.outcome === o).length;
    const challenged = count("overridden") + count("disputed");
    const challengedFirst = [...decided].sort((a, b) => rank(a.outcome!) - rank(b.outcome!) || b.at.getTime() - a.at.getTime());
    return {
      code,
      kind: g.kind,
      ruleCodes: [...new Set(g.problems.map((p) => p.latest).filter((f) => f.sourceType === "rule").map((f) => f.sourceCode!))].sort(),
      foundBy: {
        rule: g.problems.filter((p) => p.latest.origins.includes("rule")).length,
        ai: g.problems.filter((p) => p.latest.origins.includes("ai")).length,
      },
      decisions: decided.length,
      accepted: count("accepted"),
      edited: count("edited"),
      disputed: count("disputed"),
      overridden: count("overridden"),
      challengeRate: decided.length ? round(challenged / decided.length) : 0,
      flagged: false,
      why: null,
      cases: challengedFirst.slice(0, MAX_CASES).map((p) => ({
        findingId: p.latest.id,
        contentItemId: p.latest.contentItemId,
        title: p.latest.item.title,
        quote: p.latest.quote,
        explanation: p.latest.explanation,
        outcome: p.outcome!,
        reason: p.reason,
        by: p.by,
        at: p.at.toISOString(),
      })),
    };
  });

  const totalDecided = entries.reduce((n, e) => n + e.decisions, 0);
  const totalChallenged = entries.reduce((n, e) => n + e.disputed + e.overridden, 0);
  const orgAverage = totalDecided ? round(totalChallenged / totalDecided) : 0;
  const bar = Math.max(MIN_RATE, ABOVE_AVERAGE * orgAverage);
  for (const e of entries) {
    const challenged = e.disputed + e.overridden;
    if (e.decisions >= MIN_DECISIONS && challenged >= MIN_CHALLENGED && e.challengeRate >= bar) {
      e.flagged = true;
      e.why = `${challenged} of ${e.decisions} decisions went against this ${e.kind} (${pct(e.challengeRate)}), ` +
        `against ${pct(orgAverage)} across all guidelines.`;
    }
  }

  entries.sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.challengeRate - a.challengeRate || b.decisions - a.decisions);
  return {
    orgAverage,
    thresholds: { minDecisions: MIN_DECISIONS, minChallenged: MIN_CHALLENGED, minRate: MIN_RATE, aboveAverage: ABOVE_AVERAGE },
    entries,
  };
}

const ORDER: Outcome[] = ["overridden", "disputed", "edited", "accepted"];
const rank = (o: Outcome) => ORDER.indexOf(o);
const round = (x: number) => Math.round(x * 1000) / 1000;
const pct = (x: number) => `${Math.round(x * 100)}%`;
