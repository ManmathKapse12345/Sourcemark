import type { AnalyzeRequest } from "@sourcemark/contract";
import type { Db } from "../db.js";

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

// The organisation's active brand kit in wire format: active rules, all active facts
// (including superseded values, so outdated figures can be explained), and clauses from
// published guideline versions.
export async function loadBrandKit(db: Db, orgId: string): Promise<AnalyzeRequest["brand_kit"]> {
  const [rules, facts, clauses] = await Promise.all([
    db.rule.findMany({ where: { orgId, active: true }, orderBy: { createdAt: "asc" } }),
    db.fact.findMany({ where: { orgId, active: true }, orderBy: { createdAt: "asc" } }),
    db.clause.findMany({
      where: { orgId, version: { status: "PUBLISHED" } },
      orderBy: [{ versionId: "asc" }, { position: "asc" }],
      select: { code: true, heading: true, text: true },
    }),
  ]);

  return {
    rules: rules.map((r) => ({
      code: r.code,
      type: r.type,
      severity: r.severity,
      clause_code: r.clauseCode,
      message: r.message,
      config: r.config as Record<string, unknown>,
    })),
    facts: facts.map((f) => ({
      code: f.code,
      subject: f.subject,
      aliases: f.aliases,
      attribute: f.attribute,
      kind: f.kind,
      value: f.value,
      unit: f.unit,
      valid_from: isoDate(f.validFrom),
      valid_until: f.validUntil ? isoDate(f.validUntil) : null,
      source: f.source,
    })),
    clauses,
  };
}
