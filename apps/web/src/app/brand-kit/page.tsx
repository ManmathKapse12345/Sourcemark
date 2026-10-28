"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Channel, FactKind, RuleType, Severity } from "@sourcemark/contract";
import { useAuth, useOrgApi } from "@/lib/auth";
import type { Asset, Clause, Fact, Guideline, Rule } from "@/lib/types";
import { Badge, Empty, ErrorNote, Loading, SeverityBadge } from "@/components/ui";

const TABS = ["Guidelines", "Rules", "Facts", "Assets"] as const;
type Tab = (typeof TABS)[number];
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const RULE_LABEL: Record<string, string> = {
  banned_term: "Banned words", terminology: "Preferred name", all_caps: "No capitals for emphasis",
  punctuation: "Exclamation marks", long_sentence: "Sentence length", required_disclosure: "Required disclosure",
};

export default function BrandKitPage() {
  return <Suspense><BrandKit /></Suspense>;
}

function BrandKit() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (TABS.find((t) => t === params.get("tab")) ?? "Guidelines") as Tab;
  return (
    <section className="space-y-5">
      <div>
        <h1>Brand kit</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">Everything Sourcemark checks against. Every item has a code (G-2.1, R-4, F-2) so each finding can cite it.</p>
      </div>
      <div role="tablist" className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => router.replace(`/brand-kit?tab=${t}`)}
            className={`-mb-px px-3 py-2 text-sm ${tab === t ? "border-b-2 border-brand font-medium" : "text-slate-500 hover:text-ink"}`}>{t}</button>
        ))}
      </div>
      {tab === "Guidelines" && <Guidelines />}
      {tab === "Rules" && <Rules />}
      {tab === "Facts" && <Facts />}
      {tab === "Assets" && <Assets />}
    </section>
  );
}

function useKit() {
  const { orgId, can } = useAuth();
  const orgApi = useOrgApi();
  const qc = useQueryClient();
  return { orgId, admin: can("ADMIN"), orgApi, invalidate: (k: string) => qc.invalidateQueries({ queryKey: [k] }) };
}

/* ---------------- Guidelines ---------------- */

function Guidelines() {
  const { orgId, admin, orgApi, invalidate } = useKit();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["guidelines", orgId], queryFn: () => orgApi<{ guidelines: Guideline[] }>("/guidelines") });
  const upload = useMutation({
    mutationFn: () => {
      if (file) { const f = new FormData(); f.append("title", title); f.append("file", file); return orgApi<{ guideline: { id: string } }>("/guidelines", { body: f }); }
      return orgApi<{ guideline: { id: string } }>("/guidelines", { body: { title, text } });
    },
    onSuccess: (g) => { setTitle(""); setFile(null); setText(""); setOpenId(g.guideline.id); void invalidate("guidelines"); },
  });
  return (
    <div className="space-y-4">
      {admin && (
        <form className="card space-y-3" onSubmit={(e) => { e.preventDefault(); upload.mutate(); }}>
          <h2 className="text-sm font-semibold">Add a guideline</h2>
          <input className="input" placeholder="Title, e.g. Voice and claims guide" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="btn-secondary cursor-pointer">{file ? file.name : "Upload PDF, DOCX or TXT"}<input type="file" className="sr-only" accept=".pdf,.docx,.txt,.md" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
            {!file && <span className="text-slate-500">or paste the text below</span>}
          </div>
          {!file && <textarea className="input h-28" placeholder="Paste guideline text. Each paragraph becomes a clause you can review." value={text} onChange={(e) => setText(e.target.value)} />}
          <ErrorNote error={upload.error} />
          <button className="btn-primary" disabled={upload.isPending || (!file && !text.trim())}>{upload.isPending ? "Reading the guideline…" : "Create draft"}</button>
          <p className="text-xs text-slate-500">Nothing is used in checks until you review the clauses and publish.</p>
        </form>
      )}
      {q.isLoading ? <Loading /> : <ErrorNote error={q.error} />}
      {q.data && !q.data.guidelines.length && <Empty>No guidelines yet.</Empty>}
      {q.data?.guidelines.map((g) => (
        <div key={g.id} className="card space-y-3">
          <button className="flex w-full items-center gap-3 text-left" onClick={() => setOpenId(openId === g.id ? null : g.id)} aria-expanded={openId === g.id}>
            <h2 className="font-semibold">{g.title}</h2>
            {g.versions.map((v) => <Badge key={v.id} className={v.status === "DRAFT" ? "bg-amber-100 text-amber-800" : v.status === "PUBLISHED" ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-600"}>v{v.number} {v.status.toLowerCase()}</Badge>)}
            <span className="ml-auto text-sm text-slate-500">{openId === g.id ? "Hide" : "Open"}</span>
          </button>
          {openId === g.id && <GuidelineDetail id={g.id} />}
        </div>
      ))}
    </div>
  );
}

function GuidelineDetail({ id }: { id: string }) {
  const { admin, orgApi, invalidate } = useKit();
  const q = useQuery({ queryKey: ["guideline", id], queryFn: () => orgApi<Guideline>(`/guidelines/${id}`) });
  const refresh = () => { void invalidate("guideline"); void invalidate("guidelines"); };
  const publish = useMutation({ mutationFn: (vid: string) => orgApi(`/guideline-versions/${vid}/publish`, { method: "POST", body: {} }), onSuccess: refresh });
  const dropDraft = useMutation({ mutationFn: (vid: string) => orgApi(`/guideline-versions/${vid}`, { method: "DELETE" }), onSuccess: refresh });
  const newVersion = useMutation({
    mutationFn: (clauses: Clause[]) => orgApi(`/guidelines/${id}/versions`, { body: { text: clauses.map((c) => (c.heading ? `${c.heading}\n${c.text}` : c.text)).join("\n\n") } }),
    onSuccess: refresh,
  });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorNote error={q.error} />;
  const v = q.data.versions[0];
  if (!v) return null;
  const draft = v.status === "DRAFT";
  return (
    <div className="space-y-3 border-t border-slate-200 pt-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-600">Version {v.number} · {v.clauses?.length ?? 0} clauses · {draft ? "draft, not used in checks yet" : "in use"}</span>
        {admin && draft && <>
          <button className="btn-primary ml-auto" disabled={publish.isPending} onClick={() => publish.mutate(v.id)}>{publish.isPending ? "Publishing…" : "Publish"}</button>
          <button className="btn-secondary" disabled={dropDraft.isPending} onClick={() => dropDraft.mutate(v.id)}>Delete draft</button>
        </>}
        {admin && !draft && <button className="btn-secondary ml-auto" disabled={newVersion.isPending} onClick={() => newVersion.mutate(v.clauses ?? [])}>Start a new version</button>}
      </div>
      <ErrorNote error={publish.error ?? dropDraft.error ?? newVersion.error} />
      <ul className="space-y-2">{v.clauses?.map((c) => <ClauseRow key={c.id} c={c} editable={admin && draft} onChange={refresh} />)}</ul>
      {admin && draft && <AddClause versionId={v.id} onDone={refresh} />}
      {admin && <SuggestRules key={v.id} versionId={v.id} />}
    </div>
  );
}

function ClauseRow({ c, editable, onChange }: { c: Clause; editable: boolean; onChange: () => void }) {
  const { orgApi } = useKit();
  const [text, setText] = useState<string | null>(null);
  const save = useMutation({ mutationFn: () => orgApi(`/clauses/${c.id}`, { method: "PATCH", body: { text } }), onSuccess: () => { setText(null); onChange(); } });
  const del = useMutation({ mutationFn: () => orgApi(`/clauses/${c.id}`, { method: "DELETE" }), onSuccess: onChange });
  return (
    <li className="rounded-xl bg-slate-50 p-3 text-sm">
      <div className="flex items-start gap-3">
        <span className="w-14 shrink-0 font-mono text-xs text-brand">{c.code}</span>
        <div className="min-w-0 flex-1 space-y-1">
          {c.heading && <p className="font-medium">{c.heading}</p>}
          {text === null ? <p className="text-slate-700">{c.text}</p> : <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} aria-label={`Edit ${c.code}`} />}
        </div>
        {editable && (text === null
          ? <span className="flex gap-2 text-xs"><button className="text-brand hover:underline" onClick={() => setText(c.text)}>Edit</button><button className="text-red-700 hover:underline" disabled={del.isPending} onClick={() => del.mutate()}>Remove</button></span>
          : <span className="flex gap-2 text-xs"><button className="text-brand hover:underline" disabled={save.isPending} onClick={() => save.mutate()}>Save</button><button className="hover:underline" onClick={() => setText(null)}>Cancel</button></span>)}
      </div>
      <ErrorNote error={save.error ?? del.error} />
    </li>
  );
}

function AddClause({ versionId, onDone }: { versionId: string; onDone: () => void }) {
  const { orgApi } = useKit();
  const [heading, setHeading] = useState("");
  const [text, setText] = useState("");
  const add = useMutation({
    mutationFn: () => orgApi(`/guideline-versions/${versionId}/clauses`, { body: { text, heading: heading || null } }),
    onSuccess: () => { setHeading(""); setText(""); onDone(); },
  });
  return (
    <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
      <input className="input sm:!w-48" placeholder="Heading (optional)" value={heading} onChange={(e) => setHeading(e.target.value)} />
      <input className="input min-w-0 flex-1" placeholder="New clause text" value={text} onChange={(e) => setText(e.target.value)} required />
      <button className="btn-secondary" disabled={add.isPending}>Add clause</button>
      <ErrorNote error={add.error} />
    </form>
  );
}

type Suggestion = { clause_code: string; type: string; severity: string; message: string; config: Record<string, unknown> };
function SuggestRules({ versionId }: { versionId: string }) {
  const { orgApi, invalidate } = useKit();
  const [added, setAdded] = useState<number[]>([]);
  const suggest = useMutation({ mutationFn: () => orgApi<{ suggestions: Suggestion[] }>(`/guideline-versions/${versionId}/suggest-rules`, { method: "POST", body: {} }) });
  const add = useMutation({
    mutationFn: ({ s }: { s: Suggestion; i: number }) => orgApi("/rules", { body: { type: s.type, severity: s.severity, message: s.message, clauseCode: s.clause_code, config: s.config } }),
    onSuccess: (_r, { i }) => { setAdded((a) => [...a, i]); void invalidate("rules"); },
  });
  return (
    <div className="space-y-2 rounded-xl border border-dashed border-slate-300 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm"><b>Suggest rules from this guideline.</b> <span className="text-slate-600">Turns clauses into checks that run on every draft. You confirm each one.</span></p>
        <button className="btn-secondary ml-auto" disabled={suggest.isPending} onClick={() => suggest.mutate()}>{suggest.isPending ? "Reading clauses…" : "Suggest rules"}</button>
      </div>
      <ErrorNote error={suggest.error ?? add.error} />
      {suggest.data && !suggest.data.suggestions.length && <p className="text-sm text-slate-500">No rules could be suggested from these clauses.</p>}
      {suggest.data?.suggestions.map((s, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2.5 text-sm">
          <span className="font-mono text-xs text-brand">{s.clause_code}</span>
          <span className="min-w-0 flex-1">{s.message} <span className="text-xs text-slate-500">({RULE_LABEL[s.type] ?? s.type})</span></span>
          <SeverityBadge s={s.severity} />
          {added.includes(i) ? <span className="text-xs text-green-800">✓ Added</span> : <button className="btn-primary !py-1 !text-xs" disabled={add.isPending} onClick={() => add.mutate({ s, i })}>Add rule</button>}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Rules ---------------- */

function Rules() {
  const { orgId, admin, orgApi, invalidate } = useKit();
  const q = useQuery({ queryKey: ["rules", orgId], queryFn: () => orgApi<{ rules: (Rule & { config: Record<string, unknown> })[] }>("/rules") });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: object }) => orgApi(`/rules/${id}`, { method: "PATCH", body }), onSuccess: () => invalidate("rules") });
  return (
    <div className="space-y-4">
      {admin && <NewRule />}
      <ErrorNote error={q.error ?? patch.error} />
      {q.isLoading ? <Loading /> : !q.data?.rules.length ? <Empty>No rules yet.</Empty> : (
        <ul className="card divide-y divide-slate-200 !p-0">
          {q.data.rules.map((r) => (
            <li key={r.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 text-sm ${r.active ? "" : "opacity-60"}`}>
              <span className="w-10 font-mono text-xs text-brand">{r.code}</span>
              <span className="min-w-0 flex-1">{r.message} <span className="text-xs text-slate-500">· {RULE_LABEL[r.type] ?? r.type}{r.clauseCode ? ` · from ${r.clauseCode}` : ""}</span></span>
              {admin ? (
                <select className="input !w-auto !py-1 text-xs" value={r.severity} aria-label={`Severity of ${r.code}`} onChange={(e) => patch.mutate({ id: r.id, body: { severity: e.target.value } })}>
                  {Severity.options.map((s) => <option key={s}>{s}</option>)}
                </select>
              ) : <SeverityBadge s={r.severity} />}
              {admin ? (
                <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={r.active} onChange={(e) => patch.mutate({ id: r.id, body: { active: e.target.checked } })} /> On</label>
              ) : !r.active && <Badge className="bg-slate-200">off</Badge>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewRule() {
  const { orgApi, invalidate } = useKit();
  const [type, setType] = useState("banned_term");
  const [severity, setSeverity] = useState("medium");
  const [message, setMessage] = useState("");
  const [clauseCode, setClauseCode] = useState("");
  const [a, setA] = useState(""); // main list / value
  const [b, setB] = useState(""); // secondary value
  const [channels, setChannels] = useState<string[]>(["creator_post"]);
  const [atStart, setAtStart] = useState(true);
  const config = () => ({
    banned_term: { terms: csv(a), replacement: b || null },
    terminology: { preferred: a, variants: csv(b) },
    all_caps: { allow: csv(a) },
    punctuation: { max_exclamations: Number(a || 1) },
    long_sentence: { max_words: Number(a || 30) },
    required_disclosure: { channels, any_of: csv(a), at_start: atStart },
  })[type];
  const create = useMutation({
    mutationFn: () => orgApi("/rules", { body: { type, severity, message, clauseCode: clauseCode || null, config: config() } }),
    onSuccess: () => { setMessage(""); setA(""); setB(""); setClauseCode(""); void invalidate("rules"); },
  });
  const fields: Record<string, [string, string?]> = {
    banned_term: ["Banned words, comma separated", "Suggested replacement (optional)"],
    terminology: ["Preferred name, e.g. Calm Barrier Moisturiser", "Wrong variants, comma separated"],
    all_caps: ["Allowed acronyms, e.g. SPF, UV, INR"],
    punctuation: ["Most exclamation marks allowed per post"],
    long_sentence: ["Most words per sentence"],
    required_disclosure: ["Accepted tags, e.g. #ad, #sponsored"],
  };
  return (
    <details className="card">
      <summary className="cursor-pointer text-sm font-semibold">+ New rule</summary>
      <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <select className="input" value={type} onChange={(e) => { setType(e.target.value); setA(""); setB(""); }} aria-label="Rule type">
          {RuleType.options.map((t) => <option key={t} value={t}>{RULE_LABEL[t]}</option>)}
        </select>
        <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
          {Severity.options.map((s) => <option key={s}>{s}</option>)}
        </select>
        <input className="input sm:col-span-2" placeholder="Message people will see, e.g. Don't call any product a miracle." value={message} onChange={(e) => setMessage(e.target.value)} required />
        <input className="input" placeholder={fields[type][0]} value={a} onChange={(e) => setA(e.target.value)} required
          type={type === "punctuation" || type === "long_sentence" ? "number" : "text"} />
        {fields[type][1] ? <input className="input" placeholder={fields[type][1]} value={b} onChange={(e) => setB(e.target.value)} /> : <span />}
        {type === "required_disclosure" && (
          <div className="flex flex-wrap gap-3 text-sm sm:col-span-2">
            {Channel.options.map((c) => <label key={c}><input type="checkbox" checked={channels.includes(c)} onChange={() => setChannels(channels.includes(c) ? channels.filter((x) => x !== c) : [...channels, c])} /> {c.replace("_", " ")}</label>)}
            <label><input type="checkbox" checked={atStart} onChange={(e) => setAtStart(e.target.checked)} /> Must be at the start</label>
          </div>
        )}
        <input className="input" placeholder="Guideline clause it rests on, e.g. G-2.1 (optional)" value={clauseCode} onChange={(e) => setClauseCode(e.target.value)} />
        <button className="btn-primary" disabled={create.isPending}>Add rule</button>
        <div className="sm:col-span-2"><ErrorNote error={create.error} /></div>
      </form>
    </details>
  );
}

/* ---------------- Facts ---------------- */

function Facts() {
  const { orgId, admin, orgApi, invalidate } = useKit();
  const [showOld, setShowOld] = useState(false);
  const q = useQuery({ queryKey: ["facts", orgId, showOld], queryFn: () => orgApi<{ facts: (Fact & { validFrom?: string; validUntil?: string })[] }>(`/facts${showOld ? "?all=true" : ""}`) });
  const patch = useMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => orgApi(`/facts/${id}`, { method: "PATCH", body: { active } }), onSuccess: () => invalidate("facts") });
  return (
    <div className="space-y-4">
      {admin && <NewFact />}
      <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> Show old and switched-off facts</label>
      <ErrorNote error={q.error ?? patch.error} />
      {q.isLoading ? <Loading /> : !q.data?.facts.length ? <Empty>No facts yet.</Empty> : (
        <ul className="card divide-y divide-slate-200 !p-0">
          {q.data.facts.map((f) => (
            <li key={f.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 text-sm ${f.active && !(f.validUntil && f.validUntil.slice(0, 10) < new Date().toISOString().slice(0, 10)) ? "" : "opacity-60"}`}>
              <span className="w-10 font-mono text-xs text-brand">{f.code}</span>
              <span className="min-w-0 flex-1">{f.subject} · <span className="text-slate-500">{f.attribute}</span></span>
              <span className="font-medium">{f.kind === "money" && f.unit === "INR" ? `₹${f.value}` : `${f.value}${f.unit ? ` ${f.unit}` : ""}`}</span>
              {f.validUntil && <span className="text-xs text-slate-500">until {f.validUntil.slice(0, 10)}</span>}
              {admin && <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={f.active} onChange={(e) => patch.mutate({ id: f.id, active: e.target.checked })} /> On</label>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewFact() {
  const { orgApi, invalidate } = useKit();
  const blank = { subject: "", attribute: "", kind: "money", value: "", unit: "INR", aliases: "", validFrom: "", source: "" };
  const [f, setF] = useState(blank);
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const create = useMutation({
    mutationFn: () => orgApi("/facts", { body: { subject: f.subject, attribute: f.attribute, kind: f.kind, value: f.value, unit: f.unit || null, aliases: csv(f.aliases), validFrom: f.validFrom || undefined, source: f.source || null } }),
    onSuccess: () => { setF(blank); void invalidate("facts"); },
  });
  return (
    <details className="card">
      <summary className="cursor-pointer text-sm font-semibold">+ New approved fact</summary>
      <p className="mt-2 text-xs text-slate-500">A new value for the same product and attribute replaces the old one from its start date. The old value is kept so Sourcemark can explain outdated prices.</p>
      <form className="mt-3 grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <input className="input sm:col-span-2" placeholder="Product or subject, e.g. Calm Barrier Moisturiser" value={f.subject} onChange={set("subject")} required />
        <input className="input" placeholder="Attribute, e.g. price" value={f.attribute} onChange={set("attribute")} required />
        <select className="input" value={f.kind} onChange={set("kind")} aria-label="Kind">{FactKind.options.map((k) => <option key={k}>{k}</option>)}</select>
        <input className="input" placeholder={f.kind === "date" ? "YYYY-MM-DD" : "Value, e.g. 549"} value={f.value} onChange={set("value")} required />
        <input className="input" placeholder="Unit, e.g. INR or g" value={f.unit} onChange={set("unit")} />
        <input className="input sm:col-span-2" placeholder="Other names it goes by, comma separated" value={f.aliases} onChange={set("aliases")} />
        <input className="input" type="date" aria-label="Valid from" value={f.validFrom} onChange={set("validFrom")} />
        <input className="input sm:col-span-2" placeholder="Source, e.g. Price sheet July 2026" value={f.source} onChange={set("source")} />
        <button className="btn-primary" disabled={create.isPending}>Add fact</button>
        <div className="sm:col-span-3"><ErrorNote error={create.error} /></div>
      </form>
    </details>
  );
}

/* ---------------- Assets ---------------- */

function Assets() {
  const { orgId, admin, orgApi, invalidate } = useKit();
  const [form, setForm] = useState({ name: "", type: "logo", url: "", notes: "" });
  const q = useQuery({ queryKey: ["assets", orgId], queryFn: () => orgApi<{ assets: Asset[] }>("/assets") });
  const add = useMutation({ mutationFn: () => orgApi("/assets", { body: { ...form, url: form.url || undefined, notes: form.notes || undefined } }), onSuccess: () => { setForm({ name: "", type: "logo", url: "", notes: "" }); void invalidate("assets"); } });
  const del = useMutation({ mutationFn: (id: string) => orgApi(`/assets/${id}`, { method: "DELETE" }), onSuccess: () => invalidate("assets") });
  return (
    <div className="space-y-4">
      {admin && (
        <form className="card grid gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <input className="input" placeholder="Name, e.g. Primary logo" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input className="input" placeholder="Type, e.g. logo or colour" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} required />
          <input className="input" placeholder="Link (optional)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          <button className="btn-primary" disabled={add.isPending}>Add asset</button>
          <div className="sm:col-span-4"><ErrorNote error={add.error ?? del.error} /></div>
        </form>
      )}
      {q.isLoading ? <Loading /> : !q.data?.assets.length ? <Empty>No assets yet.</Empty> : (
        <ul className="card divide-y divide-slate-200 !p-0">
          {q.data.assets.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">{a.name}</span>
              <Badge className="bg-slate-100 text-slate-600">{a.type}</Badge>
              {a.url && <a className="text-brand underline" href={a.url} target="_blank" rel="noreferrer">Open</a>}
              {admin && <button className="text-xs text-red-700 hover:underline" onClick={() => del.mutate(a.id)}>Remove</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
