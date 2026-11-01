import type { ContentState, Role, Severity } from "@sourcemark/contract";

// Response shapes from docs/API.md. Request bodies come from @sourcemark/contract.

export type Org = { id: string; name: string };
export type Membership = { memberId: string; org: Org; roles: Role[] };
export type Me = { user: { id: string; email: string; name: string | null }; memberships: Membership[] };

export type Member = { id: string; email: string; name: string | null; roles: Role[] };

export type ContentSummary = {
  id: string;
  title: string;
  channel: string;
  state: ContentState;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  kind?: "text" | "image";
};

export type FindingResponse = {
  action: "ACCEPT" | "EDIT" | "DISPUTE";
  reason: string | null;
  editedText: string | null;
  memberId: string;
  createdAt: string;
};

export type Finding = {
  id: string;
  fingerprint: string;
  kind: "violation" | "needs_human_check";
  category: string;
  severity: Severity;
  origins: ("rule" | "ai")[];
  spanStart: number | null;
  spanEnd: number | null;
  quote: string | null;
  explanation: string;
  sourceType: "rule" | "clause" | "fact" | "asset" | "standard" | null;
  sourceCode: string | null;
  sourceClauseCode: string | null;
  sourceText: string | null;
  confidence: number | null;
  fixStart: number | null;
  fixEnd: number | null;
  fixReplacement: string | null;
  status: "OPEN" | "DISPUTED" | "CLOSED" | "SUPERSEDED";
  responses: FindingResponse[];
  boxX?: number | null;
  boxY?: number | null;
  boxW?: number | null;
  boxH?: number | null;
};

export type Rewrite = { key: string; start: number; end: number; original: string; text: string; fingerprints: string[] };

export type Run = {
  id: string;
  versionId: string;
  status: "COMPLETED" | "FAILED" | "RUNNING";
  aiStatus: "ok" | "disabled" | "unavailable";
  aiError: string | null;
  model: string | null;
  durationMs: number | null;
  createdAt: string;
  findings: Finding[];
  rewrites: Rewrite[];
  ocrText?: string | null;
  notes?: string[];
  stats?: { language?: "en" | "hi" | "hinglish" };
};

export type Version = { id: string; number: number; body: string; sourceFileName: string | null; createdAt: string; hasImage?: boolean; imageMime?: string | null; imageWidth?: number | null; imageHeight?: number | null; altText?: string | null };
export type Comment = { id: string; body: string; memberId: string; findingId: string | null; createdAt: string };
export type StateEvent = { action: string; fromState: string | null; toState: string | null; actorId: string; note: string | null; createdAt: string };

export type ContentDetail = {
  item: ContentSummary & { aiChecks: boolean };
  author: { memberId: string; email: string; name: string | null };
  versions: Version[];
  latestRun: Run | null;
  blockingFindingIds: string[];
  closedFindingCount: number;
  comments: Comment[];
  events: StateEvent[];
  availableActions: string[];
};

export type Clause = { id: string; code: string; heading: string | null; text: string };
export type GuidelineVersion = { id: string; number: number; status: string; clauses?: Clause[] };
export type Guideline = { id: string; title: string; versions: GuidelineVersion[] };
export type Rule = { id: string; code: string; type: string; severity: Severity; message: string; clauseCode: string | null; active: boolean };
export type Fact = { id: string; code: string; subject: string; attribute: string; kind: string; value: string; unit: string | null; validFrom?: string | null; validUntil?: string | null; active: boolean };
export type Asset = { id: string; code?: string; name: string; type: string; url: string | null; notes: string | null; colors?: string[]; hasImage?: boolean };
export type HealthCase = { findingId: string; contentItemId: string; title: string; quote: string | null; explanation: string; outcome: "overridden" | "disputed" | "edited" | "accepted"; reason: string | null; by: string | null; at: string };
export type HealthEntry = { code: string; kind: "clause" | "rule"; heading: string | null; text: string | null; guidelineId: string | null; canReword: boolean; ruleCodes: string[]; foundBy: { rule: number; ai: number }; decisions: number; accepted: number; edited: number; disputed: number; overridden: number; challengeRate: number; flagged: boolean; why: string | null; cases: HealthCase[] };
export type AuditEntry = { id: string; action: string; actorId: string | null; createdAt: string; [k: string]: unknown };
