import type { Db } from "../db.js";

// Atomically allocates the next number for a per-organisation counter.
export async function nextNumber(db: Db, orgId: string, kind: string): Promise<number> {
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO "OrgCounter" ("orgId", "kind", "value") VALUES (${orgId}, ${kind}, 1)
    ON CONFLICT ("orgId", "kind") DO UPDATE SET "value" = "OrgCounter"."value" + 1
    RETURNING "value"`;
  return Number(rows[0]!.value);
}

export const ruleCode = async (db: Db, orgId: string) => `R-${await nextNumber(db, orgId, "rule")}`;
export const factCode = async (db: Db, orgId: string) => `F-${await nextNumber(db, orgId, "fact")}`;

// First guideline uses "G" (clauses G-1.1, G-1.2 ...), later ones "G2", "G3" ...
export async function guidelinePrefix(db: Db, orgId: string) {
  const n = await nextNumber(db, orgId, "guideline");
  return n === 1 ? "G" : `G${n}`;
}
