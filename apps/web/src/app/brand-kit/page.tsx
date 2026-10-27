"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, useOrgApi } from "@/lib/auth";
import type { Asset, Fact, Guideline, Rule } from "@/lib/types";
import { Badge, Empty, ErrorNote, Loading, SeverityBadge } from "@/components/ui";

const TABS = ["Guidelines", "Rules", "Facts", "Assets"] as const;

export default function BrandKitPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Guidelines");
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Brand kit</h1>
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm ${tab === t ? "border-b-2 border-brand font-medium" : "text-slate-500"}`}>{t}</button>
        ))}
      </div>
      {tab === "Guidelines" && <Guidelines />}
      {tab === "Rules" && <List<Rule> path="/rules" k="rules" row={(r) => (
        <><span className="w-12 font-mono text-xs">{r.code}</span><span className="flex-1">{r.message}</span><Badge className="bg-slate-100">{r.type}</Badge><SeverityBadge s={r.severity} />{!r.active && <Badge className="bg-slate-200">inactive</Badge>}</>
      )} />}
      {tab === "Facts" && <List<Fact> path="/facts?all=true" k="facts" row={(f) => (
        <><span className="w-12 font-mono text-xs">{f.code}</span><span className="flex-1">{f.subject} · {f.attribute}</span><span>{f.value}{f.unit ? ` ${f.unit}` : ""}</span>{!f.active && <Badge className="bg-slate-200">ended</Badge>}</>
      )} />}
      {tab === "Assets" && <List<Asset> path="/assets" k="assets" row={(a) => (
        <><span className="flex-1">{a.name}</span><Badge className="bg-slate-100">{a.type}</Badge>{a.url && <a className="text-brand underline" href={a.url} target="_blank" rel="noreferrer">open</a>}</>
      )} />}
    </section>
  );
}

function List<T extends { id: string }>({ path, k, row }: { path: string; k: string; row: (x: T) => React.ReactNode }) {
  const { orgId } = useAuth();
  const orgApi = useOrgApi();
  const q = useQuery({ queryKey: [k, orgId], queryFn: () => orgApi<Record<string, T[]>>(path) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const items = q.data?.[k] ?? [];
  return items.length ? <ul className="card divide-y divide-slate-100 p-0">{items.map((x) => <li key={x.id} className="flex items-center gap-3 px-4 py-2 text-sm">{row(x)}</li>)}</ul> : <Empty>Nothing yet.</Empty>;
}

function Guidelines() {
  const { orgId, can } = useAuth();
  const orgApi = useOrgApi();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const q = useQuery({ queryKey: ["guidelines", orgId], queryFn: () => orgApi<{ guidelines: Guideline[] }>("/guidelines") });
  const upload = useMutation({
    mutationFn: () => { const f = new FormData(); f.append("title", title); f.append("file", file!); return orgApi("/guidelines", { body: f }); },
    onSuccess: () => { setTitle(""); setFile(null); void qc.invalidateQueries({ queryKey: ["guidelines"] }); },
  });
  const publish = useMutation({
    mutationFn: (vid: string) => orgApi(`/guideline-versions/${vid}/publish`, { method: "POST", body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["guidelines"] }),
  });
  return (
    <div className="space-y-4">
      {can("ADMIN") && (
        <form className="card flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); upload.mutate(); }}>
          <input className="input w-60" placeholder="Guideline title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <input type="file" accept=".pdf,.docx,.txt,.md" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
          <button className="btn-primary" disabled={upload.isPending}>Upload as draft</button>
          <ErrorNote error={upload.error} />
        </form>
      )}
      {q.isLoading ? <Loading /> : <ErrorNote error={q.error} />}
      {q.data?.guidelines.map((g) => (
        <div key={g.id} className="card space-y-2">
          <h2 className="font-semibold">{g.title}</h2>
          {g.versions.map((v) => (
            <div key={v.id} className="flex items-center gap-2 text-sm">
              v{v.number} <Badge className="bg-slate-100">{v.status.toLowerCase()}</Badge>
              {can("ADMIN") && v.status === "DRAFT" && <button className="btn-secondary ml-auto" disabled={publish.isPending} onClick={() => publish.mutate(v.id)}>Publish</button>}
            </div>
          ))}
        </div>
      ))}
      <ErrorNote error={publish.error} />
    </div>
  );
}
