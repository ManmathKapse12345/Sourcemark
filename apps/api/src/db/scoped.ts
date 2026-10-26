import { notFound } from "../http/errors.js";

// Every lookup by id goes through this check, so a valid id from another organisation
// behaves exactly like an id that does not exist.
export function owned<T extends { orgId: string }>(row: T | null, orgId: string, what: string): T {
  if (!row || row.orgId !== orgId) throw notFound(what);
  return row;
}
