"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ContentState } from "@sourcemark/contract";
import { useAuth, useOrgApi } from "@/lib/auth";
import { fmtDate, stateLabel } from "@/lib/format";
import type { ContentSummary, Fact, Guideline, Member, Rule } from "@/lib/types";
import { ErrorNote, Loading, StateBadge } from "@/components/ui";

type View = "creator" | "reviewer" | "approver" | "admin";
type Tile = { label: string; states: string[]; mineOnly?: boolean; color: string };

const WAITING: Record<string, string> = {
  DRAFT: "Writer is still working on it", CHECKING: "Being checked, or fixes in progress", IN_REVIEW: "Waiting for a reviewer’s decision",
  CHANGES_REQUESTED: "Sent back to the writer", APPROVED: "Cleared to publish", REJECTED: "Will not be published",
};

/** Each role lands on what it has to do next. */
const VIEWS: Record<View, { title: string; intro: string; focus: { label: string; states: string[]; mineOnly?: boolean; empty: string }; tiles: Tile[] }> = {
  creator: {
    title: "Your content",
    intro: "Write or paste content, fix what Sourcemark flags, then send it to a reviewer.",
    focus: { label: "Needs your attention", states: ["CHANGES_REQUESTED", "DRAFT", "CHECKING"], mineOnly: true, empty: "Nothing waiting on you. Start something new." },
    tiles: [
      { label: "Sent back to you", states: ["CHANGES_REQUESTED"], mineOnly: true, color: "text-orange-800" },
      { label: "Drafts and fixes", states: ["DRAFT", "CHECKING"], mineOnly: true, color: "text-slate-600" },
      { label: "With a reviewer", states: ["IN_REVIEW"], mineOnly: true, color: "text-blue-800" },
      { label: "Approved", states: ["APPROVED"], mineOnly: true, color: "text-green-800" },
    ],
  },
  reviewer: {
    title: "Waiting for your review",
    intro: "Each draft has already been checked. Look at what needs judgement, then approve it or send it back with a note.",
    focus: { label: "To review", states: ["IN_REVIEW"], empty: "Nothing to review right now." },
    tiles: [
      { label: "To review", states: ["IN_REVIEW"], color: "text-blue-800" },
      { label: "Back with writers", states: ["CHANGES_REQUESTED"], color: "text-orange-800" },
      { label: "Approved", states: ["APPROVED"], color: "text-green-800" },
      { label: "Rejected", states: ["REJECTED"], color: "text-red-700" },
    ],
  },
  approver: {
    title: "Ready for your sign-off",
    intro: "Every fact in these drafts has been compared with your approved sources. You make the final call.",
    focus: { label: "Needs a decision", states: ["IN_REVIEW"], empty: "Nothing is waiting for sign-off." },
    tiles: [
      { label: "Needs a decision", states: ["IN_REVIEW"], color: "text-blue-800" },
      { label: "Being fixed", states: ["CHANGES_REQUESTED", "DRAFT", "CHECKING"], color: "text-orange-800" },
      { label: "Approved", states: ["APPROVED"], color: "text-green-800" },
      { label: "Rejected", states: ["REJECTED"], color: "text-red-700" },
    ],
  },
  admin: {
    title: "Workspace overview",
    intro: "Keep the brand kit current. Everything Sourcemark checks comes from it.",
    focus: { label: "In review now", states: ["IN_REVIEW"], empty: "No content is in review." },
    tiles: [
      { label: "In review", states: ["IN_REVIEW"], color: "text-blue-800" },
      { label: "Being fixed", states: ["CHANGES_REQUESTED", "DRAFT", "CHECKING"], color: "text-orange-800" },
      { label: "Approved", states: ["APPROVED"], color: "text-green-800" },
      { label: "Rejected", states: ["REJECTED"], color: "text-red-700" },
    ],
  },
};

export default function Dashboard() {
  const { orgId, can, me, memberId } = useAuth();
  const orgApi = useOrgApi();
  const view: View = can("ADMIN") ? "admin" : can("APPROVER") ? "approver" : can("REVIEWER") ? "reviewer" : "creator";
  const cfg = VIEWS[view];
  const [state, setState] = useState("");
  const [mine, setMine] = useState(false);

  const all = useQuery({ queryKey: ["content", orgId, "", false], queryFn: () => orgApi<{ items: ContentSummary[] }>("/content") });
  const items = all.data?.items ?? [];
  const match = (c: ContentSummary, states: string[], mineOnly?: boolean) => states.includes(c.state) && (!mineOnly || c.authorId === memberId);
  const focus = items.filter((c) => match(c, cfg.focus.states, cfg.focus.mineOnly));
  const listed = items.filter((c) => (!state || c.state === state) && (!mine || c.authorId === memberId));
  const first = me?.user.name?.split(" ")[0] ?? me?.user.email.split("@")[0];

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <p className="text-sm text-slate-500">Welcome back, {first}</p>
          <h1>{cfg.title}</h1>
          <p className="mt-1 max-w-xl text-sm text-slate-600">{cfg.intro}</p>
        </div>
        {can("CREATOR") && <Link href="/content/new" className="btn-primary ml-auto">+ Check new content</Link>}
      </div>

      {view === "admin" && <AdminSnapshot />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cfg.tiles.map((t) => (
          <div key={t.label} className="card">
            <span className={`block text-4xl font-semibold tabular-nums ${t.color}`}>{items.filter((c) => match(c, t.states, t.mineOnly)).length}</span>
            <span className="text-sm text-slate-600">{t.label}</span>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="display text-2xl">{cfg.focus.label} <span className="text-slate-500">({focus.length})</span></h2>
        <ErrorNote error={all.error} />
        {all.isLoading ? <Loading /> : focus.length ? <Cards items={focus} /> : (
          <div className="card py-8 text-center text-sm text-slate-600">{cfg.focus.empty}</div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="display text-2xl">All content</h2>
          <select className="input !w-auto" value={state} onChange={(e) => setState(e.target.value)} aria-label="Filter by status">
            <option value="">Every status</option>
            {ContentState.options.map((s) => <option key={s} value={s}>{stateLabel[s]}</option>)}
          </select>
          {can("CREATOR") && <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine</label>}
        </div>
        {all.isLoading ? null : listed.length ? <Cards items={listed} /> : <p className="text-sm text-slate-500">Nothing matches this filter.</p>}
      </div>
    </section>
  );
}

function Cards({ items }: { items: ContentSummary[] }) {
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {items.map((c) => (
        <li key={c.id}>
          <Link href={`/content/${c.id}`} className="card group block space-y-2 transition hover:-translate-y-0.5 hover:border-slate-300">
            <div className="flex items-center gap-2"><StateBadge state={c.state} /><span className="ml-auto text-xs text-slate-500">{c.channel.replace("_", " ")}</span></div>
            <h3 className="text-base font-medium group-hover:text-brand">{c.title}</h3>
            <p className="text-xs text-slate-500">{WAITING[c.state]} · {fmtDate(c.updatedAt)}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function AdminSnapshot() {
  const { orgId } = useAuth();
  const orgApi = useOrgApi();
  const g = useQuery({ queryKey: ["guidelines", orgId], queryFn: () => orgApi<{ guidelines: Guideline[] }>("/guidelines") });
  const r = useQuery({ queryKey: ["rules", orgId], queryFn: () => orgApi<{ rules: Rule[] }>("/rules") });
  const f = useQuery({ queryKey: ["facts", orgId], queryFn: () => orgApi<{ facts: Fact[] }>("/facts") });
  const m = useQuery({ queryKey: ["members", orgId], queryFn: () => orgApi<{ members: Member[] }>("/") });
  const drafts = g.data?.guidelines.flatMap((x) => x.versions).filter((v) => v.status === "DRAFT").length ?? 0;
  const stats = [
    { n: g.data?.guidelines.length, l: "Guidelines", sub: drafts ? `${drafts} draft waiting to publish` : "All published", href: "/brand-kit" },
    { n: r.data?.rules.filter((x) => x.active).length, l: "Active rules", sub: "Checked by code on every draft", href: "/brand-kit?tab=Rules" },
    { n: f.data?.facts.length, l: "Approved facts", sub: "Prices, sizes, names, dates", href: "/brand-kit?tab=Facts" },
    { n: m.data?.members.length, l: "People", sub: "Manage roles", href: "/team" },
  ];
  return (
    <div className="glass grid gap-px overflow-hidden rounded-2xl sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((s) => (
        <Link key={s.l} href={s.href} className="group space-y-1 p-5 transition hover:bg-brand-soft">
          <span className="block text-3xl font-semibold tabular-nums">{s.n ?? "–"}</span>
          <span className="block font-medium group-hover:text-brand">{s.l} →</span>
          <span className="text-xs text-slate-500">{s.sub}</span>
        </Link>
      ))}
    </div>
  );
}
