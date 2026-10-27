"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ContentState } from "@sourcemark/contract";
import { useAuth, useOrgApi } from "@/lib/auth";
import { fmtDate, stateLabel } from "@/lib/format";
import type { ContentSummary } from "@/lib/types";
import { ErrorNote, Loading, StateBadge } from "@/components/ui";

const WAITING: Record<string, string> = {
  DRAFT: "Writer is still working on it", CHECKING: "Being checked against the guidelines", IN_REVIEW: "Waiting for a reviewer's decision",
  CHANGES_REQUESTED: "Sent back to the writer", APPROVED: "Cleared to publish", REJECTED: "Will not be published",
};

export default function QueuePage() {
  const { orgId, can, me } = useAuth();
  const orgApi = useOrgApi();
  const [state, setState] = useState("");
  const [mine, setMine] = useState(false);
  const all = useQuery({ queryKey: ["content", orgId, "", false], queryFn: () => orgApi<{ items: ContentSummary[] }>("/content") });
  const q = useQuery({
    queryKey: ["content", orgId, state, mine],
    queryFn: () => orgApi<{ items: ContentSummary[] }>(`/content?${new URLSearchParams({ ...(state && { state }), ...(mine && { mine: "true" }) })}`),
  });
  const count = (s: string) => all.data?.items.filter((i) => i.state === s).length ?? 0;
  const first = me?.user.name?.split(" ")[0] ?? me?.user.email.split("@")[0];
  const stats = [
    { s: "IN_REVIEW", label: "Waiting for a decision", color: "text-blue-800" },
    { s: "CHANGES_REQUESTED", label: "Sent back for changes", color: "text-orange-800" },
    { s: "DRAFT", label: "Still being written", color: "text-slate-600" },
    { s: "APPROVED", label: "Approved to publish", color: "text-green-800" },
  ];
  return (
    <section className="space-y-7">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <p className="text-sm text-slate-500">Welcome back, {first}</p>
          <h1>What needs your attention</h1>
          <p className="mt-1 max-w-xl text-sm text-slate-600">Every post, email or page is checked against your brand rules and approved facts before it goes out. People make the final call.</p>
        </div>
        {can("CREATOR") && <Link href="/content/new" className="btn-primary ml-auto">+ Check new content</Link>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((x) => (
          <button key={x.s} onClick={() => setState(state === x.s ? "" : x.s)}
            className={`card text-left transition hover:border-slate-300 ${state === x.s ? "!border-brand" : ""}`}>
            <span className={`block text-4xl font-semibold tabular-nums ${x.color}`}>{count(x.s)}</span>
            <span className="text-sm text-slate-600">{x.label}</span>
          </button>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="display text-xl">{state ? stateLabel[state] : "All content"}</h2>
          <select className="input !w-auto" value={state} onChange={(e) => setState(e.target.value)} aria-label="Filter by status">
            <option value="">Every status</option>
            {ContentState.options.map((s) => <option key={s} value={s}>{stateLabel[s]}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine</label>
        </div>
        <ErrorNote error={q.error} />
        {q.isLoading ? <Loading /> : !q.data?.items.length ? (
          <div className="card py-12 text-center">
            <p className="display text-2xl">Nothing here yet</p>
            <p className="mt-1 text-sm text-slate-600">Paste a caption or upload a document and Sourcemark will check it in seconds.</p>
          </div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {q.data.items.map((c) => (
              <li key={c.id}>
                <Link href={`/content/${c.id}`} className="card group block space-y-2 transition hover:-translate-y-0.5 hover:border-slate-300">
                  <div className="flex items-center gap-2"><StateBadge state={c.state} /><span className="ml-auto text-xs text-slate-500">{c.channel.replace("_", " ")}</span></div>
                  <h3 className="text-base font-medium group-hover:text-brand">{c.title}</h3>
                  <p className="text-xs text-slate-500">{WAITING[c.state]} · {fmtDate(c.updatedAt)}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
