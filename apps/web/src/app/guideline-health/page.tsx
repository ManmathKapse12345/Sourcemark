"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth, useOrgApi } from "@/lib/auth";
import { diffWords } from "@/lib/diff";
import type { HealthEntry, Member } from "@/lib/types";
import { Badge, Empty, ErrorNote, Loading } from "@/components/ui";

export default function GuidelineHealthPage() {
  const { can, orgId } = useAuth();
  const orgApi = useOrgApi();
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ code: string; text: string } | null>(null);
  const q = useQuery({ queryKey: ["guideline-health", orgId], queryFn: () => orgApi<{ orgAverage: number; entries: HealthEntry[] }>("/guideline-health"), enabled: can("ADMIN") });
  const members = useQuery({ queryKey: ["members", orgId], queryFn: () => orgApi<{ members: Member[] }>("/") });
  const suggest = useMutation({ mutationFn: (code: string) => orgApi<{ current: string; suggestion: string; rationale: string; caseIds: string[] }>(`/guideline-health/${encodeURIComponent(code)}/suggest`, { method: "POST", body: {} }), onSuccess: (r, code) => setEditing({ code, text: r.suggestion }) });
  const apply = useMutation({ mutationFn: () => orgApi(`/guideline-health/${editing!.code}/apply`, { method: "POST", body: { text: editing!.text } }), onSuccess: () => setEditing(null) });
  const names = useMemo(() => new Map(members.data?.members.map((m) => [m.id, m.name ?? m.email]) ?? []), [members.data]);
  if (!can("ADMIN")) return <div className="card"><h1>Admin access required</h1><p className="mt-2 text-sm text-slate-600">Guideline health is only visible to workspace admins.</p></div>;
  return <section className="space-y-5">
    <div><h1>Guideline health</h1><p className="mt-1 max-w-2xl text-sm text-slate-600">See which guidance people keep challenging, then improve the wording without losing the audit trail.</p></div>
    <ErrorNote error={q.error ?? suggest.error ?? apply.error} />
    {q.isLoading ? <Loading /> : !q.data?.entries.length ? <div className="card"><Empty>Not enough decisions yet. A clause needs at least 5 before it can be judged.</Empty></div> : <div className="space-y-3">{q.data.entries.map((e) => {
      const total = Math.max(e.decisions, 1);
      return <div key={e.code} className={`card space-y-3 ${e.flagged ? "!border-amber-300" : ""}`}>
        <button className="flex w-full items-start gap-3 text-left" onClick={() => setOpen(open === e.code ? null : e.code)} aria-expanded={open === e.code}>
          <span className="w-16 shrink-0 font-mono text-xs text-brand">{e.code}</span><span className="min-w-0 flex-1"><b>{e.heading ?? "Guideline clause"}</b><span className="mt-1 block text-sm text-slate-600">{e.text}</span></span>{e.flagged && <Badge className="bg-amber-100 text-amber-800">Unclear?</Badge>}<span className="text-xs text-slate-500">{open === e.code ? "Hide" : "Open"}</span>
        </button>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100" aria-label="Decision outcomes"><div className="flex h-full"><span className="bg-green-400" style={{ width: `${e.accepted / total * 100}%` }} /><span className="bg-blue-400" style={{ width: `${e.edited / total * 100}%` }} /><span className="bg-amber-400" style={{ width: `${e.disputed / total * 100}%` }} /><span className="bg-red-400" style={{ width: `${e.overridden / total * 100}%` }} /></div></div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500"><span>{Math.round(e.challengeRate * 100)}% challenged · workspace {Math.round((q.data.orgAverage ?? 0) * 100)}%</span><span>Found by rule {e.foundBy.rule} · AI {e.foundBy.ai}</span><span>{e.decisions} decisions</span></div>
        {e.flagged && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{e.why}</p>}
        {open === e.code && <div className="space-y-3 border-t border-slate-200 pt-3"><div className="flex flex-wrap gap-2">{e.canReword && <button className="btn-primary" disabled={suggest.isPending} onClick={() => suggest.mutate(e.code)}>Suggest clearer wording</button>}</div>{e.cases.map((c) => <div key={c.findingId} className="rounded-lg bg-slate-50 p-3 text-sm"><Link className="font-medium text-brand hover:underline" href={`/content/${c.contentItemId}`}>{c.title}</Link><p className="mt-1">{c.quote ? `“${c.quote}”` : c.explanation}</p><p className="mt-1 text-xs text-slate-500">{c.outcome} · {c.by ? names.get(c.by) ?? "Someone" : "Someone"}</p>{c.reason && <p className="mt-1 text-xs text-slate-600">“{c.reason}”</p>}</div>)}</div>}
      </div>;
    })}</div>}
    {editing && <div className="card space-y-3 border-brand"><h2 className="text-sm font-semibold">Clearer wording for {editing.code}</h2>{suggest.data && <><div className="text-sm"><p className="text-xs text-slate-500">Before → suggested</p><p>{diffWords(suggest.data.current, suggest.data.suggestion).map((p, i) => p.type === "same" ? <span key={i}>{p.text}</span> : p.type === "del" ? <del key={i} className="bg-red-100 text-red-800">{p.text}</del> : <ins key={i} className="bg-green-100 text-green-800 no-underline">{p.text}</ins>)}</p></div><p className="text-sm text-slate-600">{suggest.data.rationale}</p></>}<textarea className="input" value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} /><div className="flex gap-2"><button className="btn-primary" disabled={apply.isPending} onClick={() => apply.mutate()}>Save as draft version</button><button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button><Link className="btn-secondary" href="/brand-kit">Review in Brand Kit</Link></div></div>}
  </section>;
}
