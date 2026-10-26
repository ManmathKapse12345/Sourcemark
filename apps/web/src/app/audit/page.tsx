"use client";
import { useQuery } from "@tanstack/react-query";
import { useAuth, useOrgApi } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import type { AuditEntry } from "@/lib/types";
import { Empty, ErrorNote, Loading } from "@/components/ui";

export default function AuditPage() {
  const { orgId, can } = useAuth();
  const orgApi = useOrgApi();
  const q = useQuery({ queryKey: ["audit", orgId], queryFn: () => orgApi<{ entries: AuditEntry[] }>("/audit?limit=100"), enabled: can("ADMIN") });
  if (!can("ADMIN")) return <p>Admins only.</p>;
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Audit log</h1>
      <ErrorNote error={q.error} />
      {q.isLoading ? <Loading /> : !q.data?.entries.length ? <Empty>No events.</Empty> : (
        <ul className="card divide-y divide-slate-100 p-0">
          {q.data.entries.map((e) => (
            <li key={e.id} className="flex gap-3 px-4 py-2 text-sm">
              <span className="w-44 text-xs text-slate-500">{fmtDate(e.createdAt)}</span>
              <span className="font-mono text-xs">{e.action}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
