import { z } from "zod";
import { Channel, FindingCategory } from "./enums.js";

// Configuration for each deterministic rule type. Stored as JSON on the Rule row.

export const BannedTermConfig = z.object({
  terms: z.array(z.string().min(1)).min(1),
  replacement: z.string().nullable().default(null),
  category: FindingCategory.default("claim"),
});

export const TerminologyConfig = z.object({
  preferred: z.string().min(1),
  variants: z.array(z.string().min(1)).default([]),
});

export const AllCapsConfig = z.object({
  min_length: z.number().int().min(2).default(3),
  allow: z.array(z.string()).default([]),
});

export const PunctuationConfig = z.object({
  max_exclamations: z.number().int().min(0).default(1),
});

export const LongSentenceConfig = z.object({
  max_words: z.number().int().min(5).default(30),
});

export const RequiredDisclosureConfig = z.object({
  channels: z.array(Channel).min(1),
  any_of: z.array(z.string().min(1)).min(1),
  at_start: z.boolean().default(true),
});

export const RuleConfigByType = {
  banned_term: BannedTermConfig,
  terminology: TerminologyConfig,
  all_caps: AllCapsConfig,
  punctuation: PunctuationConfig,
  long_sentence: LongSentenceConfig,
  required_disclosure: RequiredDisclosureConfig,
} as const;
