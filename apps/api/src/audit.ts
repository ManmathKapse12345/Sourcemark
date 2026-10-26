import type { Prisma } from "@prisma/client";
import type { Db } from "./db.js";

export interface AuditEntry {
  orgId: string;
  actorId: string | null; // Member id; null for system actions
  action: string;
  entityType: string;
  entityId: string;
  data?: Prisma.InputJsonValue;
}

// Call inside the same transaction as the change it records.
export function audit(db: Db, entry: AuditEntry) {
  return db.auditLog.create({ data: entry });
}
