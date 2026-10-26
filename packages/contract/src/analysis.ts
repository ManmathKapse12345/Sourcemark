import { z } from "zod";
import {
  Channel,
  FactKind,
  FindingCategory,
  FindingKind,
  FindingOrigin,
  RuleType,
  Severity,
} from "./enums.js";

// Wire format between the Express API and the internal analysis service.
// snake_case on purpose: the other side is Python. services/analysis/app/contract.py mirrors this file,
// and both sides are tested against packages/contract/fixtures.

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const RuleDTO = z.object({
  code: z.string(),
  type: RuleType,
  severity: Severity,
  clause_code: z.string().nullable(),
  message: z.string(),
  config: z.record(z.string(), z.unknown()),
});
export type RuleDTO = z.infer<typeof RuleDTO>;

export const FactDTO = z.object({
  code: z.string(),
  subject: z.string(),
  aliases: z.array(z.string()),
  attribute: z.string(),
  kind: FactKind,
  value: z.string(),
  unit: z.string().nullable(),
  valid_from: IsoDate,
  valid_until: IsoDate.nullable(),
  source: z.string().nullable(),
});
export type FactDTO = z.infer<typeof FactDTO>;

export const ClauseDTO = z.object({
  code: z.string(),
  heading: z.string().nullable(),
  text: z.string(),
});
export type ClauseDTO = z.infer<typeof ClauseDTO>;

export const AnalyzeRequest = z.object({
  org_id: z.string(),
  content: z.object({
    text: z.string(),
    channel: Channel,
  }),
  brand_kit: z.object({
    rules: z.array(RuleDTO),
    facts: z.array(FactDTO),
    clauses: z.array(ClauseDTO),
  }),
  options: z.object({
    ai: z.boolean(),
    as_of: IsoDate.nullable(),
  }),
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequest>;

export const Span = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
});

export const FindingSource = z.object({
  type: z.enum(["rule", "clause", "fact"]),
  code: z.string(),
  clause_code: z.string().nullable(),
  text: z.string(),
});

export const Fix = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  replacement: z.string(),
});

export const FindingDTO = z.object({
  fingerprint: z.string(),
  kind: FindingKind,
  category: FindingCategory,
  severity: Severity,
  origins: z.array(FindingOrigin).min(1),
  span: Span.nullable(),
  quote: z.string(),
  explanation: z.string(),
  source: FindingSource.nullable(),
  confidence: z.number().min(0).max(1),
  fix: Fix.nullable(),
});
export type FindingDTO = z.infer<typeof FindingDTO>;

export const RewriteDTO = z.object({
  id: z.string(),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  original: z.string(),
  text: z.string(),
  finding_fingerprints: z.array(z.string()),
});
export type RewriteDTO = z.infer<typeof RewriteDTO>;

export const AnalyzeResponse = z.object({
  findings: z.array(FindingDTO),
  rewrites: z.array(RewriteDTO),
  ai_status: z.enum(["ok", "disabled", "unavailable"]),
  ai_error: z.string().nullable(),
  model: z.string().nullable(),
  stats: z.object({
    rule_findings: z.number().int(),
    ai_findings: z.number().int(),
    ai_downgraded: z.number().int(),
    ai_dropped_unanchored: z.number().int(),
    merged: z.number().int(),
    duration_ms: z.number().int(),
  }),
});
export type AnalyzeResponse = z.infer<typeof AnalyzeResponse>;

export const ParseResponse = z.object({
  text: z.string(),
  format: z.enum(["pdf", "docx", "txt"]),
  warnings: z.array(z.string()),
});
export type ParseResponse = z.infer<typeof ParseResponse>;

export const ExtractedClause = z.object({
  code: z.string(),
  heading: z.string().nullable(),
  text: z.string(),
});

export const ExtractGuidelineResponse = z.object({
  clauses: z.array(ExtractedClause),
  warnings: z.array(z.string()),
});
export type ExtractGuidelineResponse = z.infer<typeof ExtractGuidelineResponse>;

export const EmbedRequest = z.object({
  texts: z.array(z.string()).min(1),
  task: z.enum(["document", "query"]),
});
export type EmbedRequest = z.infer<typeof EmbedRequest>;

export const EmbedResponse = z.object({
  model: z.string(),
  dim: z.number().int(),
  vectors: z.array(z.array(z.number())),
});
export type EmbedResponse = z.infer<typeof EmbedResponse>;

export const SuggestRulesRequest = z.object({
  clauses: z.array(ClauseDTO).min(1),
});
export type SuggestRulesRequest = z.infer<typeof SuggestRulesRequest>;

export const SuggestRulesResponse = z.object({
  suggestions: z.array(
    z.object({
      clause_code: z.string(),
      type: RuleType,
      severity: Severity,
      message: z.string(),
      config: z.record(z.string(), z.unknown()),
    }),
  ),
});
export type SuggestRulesResponse = z.infer<typeof SuggestRulesResponse>;
