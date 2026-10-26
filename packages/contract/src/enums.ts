import { z } from "zod";

// Shared vocabularies. Lower-case values are used on the wire and stored as-is in Postgres enums.

export const Role = z.enum(["CREATOR", "REVIEWER", "APPROVER", "ADMIN"]);
export type Role = z.infer<typeof Role>;

export const ContentState = z.enum([
  "DRAFT",
  "CHECKING",
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "REJECTED",
]);
export type ContentState = z.infer<typeof ContentState>;

export const TransitionAction = z.enum([
  "SUBMIT",
  "RESOLVE",
  "REQUEST_CHANGES",
  "APPROVE",
  "REJECT",
  "REVISE",
]);
export type TransitionAction = z.infer<typeof TransitionAction>;

export const Channel = z.enum([
  "website",
  "instagram",
  "creator_post",
  "linkedin",
  "x",
  "youtube",
  "email",
  "print",
  "press_release",
  "other",
]);
export type Channel = z.infer<typeof Channel>;

export const RuleType = z.enum([
  "banned_term",
  "terminology",
  "all_caps",
  "punctuation",
  "long_sentence",
  "required_disclosure",
]);
export type RuleType = z.infer<typeof RuleType>;

export const FactKind = z.enum(["money", "quantity", "name", "date", "claim"]);
export type FactKind = z.infer<typeof FactKind>;

export const Severity = z.enum(["high", "medium", "low"]);
export type Severity = z.infer<typeof Severity>;

export const FindingKind = z.enum(["violation", "needs_human_check"]);
export type FindingKind = z.infer<typeof FindingKind>;

export const FindingCategory = z.enum([
  "terminology",
  "fact",
  "claim",
  "tone",
  "style",
  "readability",
  "disclosure",
  "inclusivity",
]);
export type FindingCategory = z.infer<typeof FindingCategory>;

export const FindingOrigin = z.enum(["rule", "ai"]);
export type FindingOrigin = z.infer<typeof FindingOrigin>;

export const ResponseAction = z.enum(["ACCEPT", "EDIT", "DISPUTE"]);
export type ResponseAction = z.infer<typeof ResponseAction>;
