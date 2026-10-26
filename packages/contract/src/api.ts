import { z } from "zod";
import {
  Channel,
  FactKind,
  ResponseAction,
  Role,
  RuleType,
  Severity,
  TransitionAction,
} from "./enums.js";

// Request bodies for the public Express API (camelCase). The frontend can import these
// to validate forms with the same schemas the server uses.

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const CreateOrgBody = z.object({
  name: z.string().trim().min(2).max(120),
});

export const AddMemberBody = z.object({
  email: z.email(),
  roles: z.array(Role).min(1),
});

export const UpdateMemberBody = z.object({
  roles: z.array(Role).min(1),
});

export const CreateGuidelineBody = z.object({
  title: z.string().trim().min(2).max(200),
  // Plain text alternative to uploading a PDF or DOCX.
  text: z.string().min(1).optional(),
});

export const UpdateClauseBody = z.object({
  heading: z.string().nullable().optional(),
  text: z.string().trim().min(1).optional(),
});

export const AddClauseBody = z.object({
  code: z.string().trim().min(1).max(40).optional(),
  heading: z.string().nullable().optional(),
  text: z.string().trim().min(1),
});

export const CreateRuleBody = z.object({
  type: RuleType,
  severity: Severity,
  clauseCode: z.string().nullable().optional(),
  message: z.string().trim().min(1).max(500),
  config: z.record(z.string(), z.unknown()),
});

export const UpdateRuleBody = z.object({
  severity: Severity.optional(),
  clauseCode: z.string().nullable().optional(),
  message: z.string().trim().min(1).max(500).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  active: z.boolean().optional(),
});

export const CreateFactBody = z.object({
  subject: z.string().trim().min(1).max(200),
  aliases: z.array(z.string().trim().min(1)).default([]),
  attribute: z.string().trim().min(1).max(100),
  kind: FactKind,
  value: z.string().trim().min(1).max(1000),
  unit: z.string().trim().max(20).nullable().optional(),
  validFrom: IsoDate.optional(),
  source: z.string().max(500).nullable().optional(),
});

export const UpdateFactBody = z.object({
  aliases: z.array(z.string().trim().min(1)).optional(),
  source: z.string().max(500).nullable().optional(),
  active: z.boolean().optional(),
});

export const CreateAssetBody = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(["logo", "palette", "font", "image", "other"]),
  url: z.url().nullable().optional(),
  colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).default([]),
  notes: z.string().max(1000).nullable().optional(),
});

export const CreateContentBody = z.object({
  title: z.string().trim().min(1).max(200),
  channel: Channel,
  // Either body text, or a DOCX/PDF/TXT file sent as multipart field "file".
  body: z.string().min(1).max(100_000).optional(),
  // false: rule checks only, the draft is never sent to the external LLM.
  aiChecks: z.boolean().default(true),
});

export const CreateVersionBody = z
  .object({
    body: z.string().min(1).max(100_000).optional(),
    // Build the new version by applying the ACCEPT/EDIT responses on the latest run.
    applyResponses: z.boolean().optional(),
    // Sentence-level rewrites to apply, by id from the latest run.
    applyRewriteIds: z.array(z.string()).optional(),
  })
  .refine((b) => b.body !== undefined || b.applyResponses || b.applyRewriteIds?.length, {
    message: "Provide body, applyResponses or applyRewriteIds",
  });

export const TransitionBody = z.object({
  action: TransitionAction,
  note: z.string().max(2000).optional(),
});

export const FindingResponseBody = z
  .object({
    action: ResponseAction,
    reason: z.string().trim().max(1000).optional(),
    editedText: z.string().max(5000).optional(),
  })
  .refine((b) => b.action !== "DISPUTE" || (b.reason && b.reason.length >= 3), {
    message: "A dispute needs a short reason",
    path: ["reason"],
  })
  .refine((b) => b.action !== "EDIT" || b.editedText !== undefined, {
    message: "An edit needs editedText",
    path: ["editedText"],
  });

export const CommentBody = z.object({
  body: z.string().trim().min(1).max(5000),
  findingId: z.string().optional(),
  versionId: z.string().optional(),
});
