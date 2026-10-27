"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgApi } from "@/lib/auth";
import type { Finding } from "@/lib/types";
import { Badge, ErrorNote } from "./ui";
import { sentencePreview } from "@/lib/diff";

const SOURCE_LABEL: Record<string, string> = { rule: "Your brand rule", clause: "Your guideline says", fact: "Your approved fact sheet says" };
const CATEGORY: Record<string, string> = { terminology: "Wording", fact: "Facts & prices", claim: "Claim", tone: "Tone", style: "Style", readability: "Readability", disclosure: "Disclosure", inclusivity: "Inclusive language" };

export function FindingCard({ f, body, active, canRespond, contentId, onSelect, showDispute = false }: {
  f: Finding; body: string; active: boolean; canRespond: boolean; contentId: string; onSelect: () => void; showDispute?: boolean;
}) {
  const orgApi = useOrgApi();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"edit" | "dispute" | null>(null);
  const [text, setText] = useState(f.fixReplacement ?? "");
  const respond = useMutation({
    mutationFn: (body: object) => orgApi(`/findings/${f.id}/responses`, { body }),
    onSuccess: () => { setMode(null); setChanging(false); void qc.invalidateQueries({ queryKey: ["content-detail", contentId] }); },
  });
  const last = f.responses.at(-1);
  const disputed = last?.action === "DISPUTE";
  const span = f.fixStart != null && f.fixEnd != null ? [f.fixStart, f.fixEnd] : f.spanStart != null && f.spanEnd != null ? [f.spanStart, f.spanEnd] : null;
  const preview = mode === "edit" && span ? sentencePreview(body, span[0], span[1], text) : null;
  const needsCheck = f.kind === "needs_human_check";
  const closed = f.status === "CLOSED" || f.status === "SUPERSEDED";
  const [changing, setChanging] = useState(false);

  return (
    <div id={`finding-${f.id}`} onClick={onSelect}
      className={`card space-y-3 transition ${disputed && showDispute ? "!border-amber-300" : ""} ${active ? "!border-brand shadow-[0_0_0_1px_var(--color-brand),0_12px_40px_-12px_rgba(245,196,81,0.35)]" : ""} ${closed ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${needsCheck ? "text-amber-800" : "text-red-700"}`}>
          <span className={`size-2 rounded-full ${needsCheck ? "bg-brand" : "bg-red-600"}`} />
          {needsCheck ? "Please confirm" : "Problem"}
        </span>
        <Badge className="bg-slate-100 text-slate-600">{CATEGORY[f.category] ?? f.category}</Badge>
        {f.severity === "high" && !needsCheck && <Badge className="bg-red-100 text-red-800">Serious</Badge>}
        <span className="ml-auto text-[11px] text-slate-500">{f.origins.includes("ai") && f.origins.includes("rule") ? "Rule + AI" : f.origins[0] === "ai" ? "Found by AI" : "Found by a rule"}</span>
        {closed && <Badge className="bg-green-100 text-green-800">Resolved</Badge>}
      </div>

      {disputed && showDispute && (
        <div className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-800">
          <b>The writer says this is wrong:</b> “{last!.reason}”. Decide whether the rule really applies here.
        </div>
      )}
      <p className="text-[15px] leading-snug">{f.explanation}</p>

      {f.fixReplacement != null && f.quote && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2.5 text-sm">
          <span className="rounded bg-red-100 px-1.5 text-red-800 line-through">{f.quote}</span>
          <span aria-hidden className="text-slate-500">→</span>
          <span className="rounded bg-green-100 px-1.5 font-medium text-green-800">{f.fixReplacement || "(remove)"}</span>
        </div>
      )}

      {f.sourceText && (
        <div className="rounded-lg border border-slate-200 p-2.5 text-xs">
          <p className="mb-0.5 font-medium text-slate-600">{SOURCE_LABEL[f.sourceType ?? "rule"]} <span className="font-mono text-brand">{f.sourceCode}</span></p>
          <p className="text-slate-500">“{f.sourceText}”</p>
        </div>
      )}

      {last && !changing && (
        <div className="flex items-center gap-2 rounded-lg bg-green-100/60 px-3 py-2 text-sm text-green-800">
          <span aria-hidden>✓</span>
          <span className="min-w-0 flex-1">{last.action === "ACCEPT" ? "Fix chosen" : last.action === "EDIT" ? `Your wording: “${last.editedText}”` : `Disputed: ${last.reason}`}</span>
          {canRespond && !closed && <button className="text-xs underline" onClick={(e) => { e.stopPropagation(); setChanging(true); }}>Change</button>}
        </div>
      )}

      {canRespond && !closed && (!last || changing) && (mode === null ? (
        <div className="flex flex-wrap gap-2">
          {f.fixReplacement != null && <button className="btn-primary" disabled={respond.isPending} onClick={() => respond.mutate({ action: "ACCEPT" })}>Use this fix</button>}
          <button className="btn-secondary" onClick={() => setMode("edit")}>Write my own</button>
          <button className="btn-secondary" onClick={() => { setText(""); setMode("dispute"); }}>This is wrong</button>
        </div>
      ) : (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); respond.mutate(mode === "edit" ? { action: "EDIT", editedText: text } : { action: "DISPUTE", reason: text }); }}>
          {mode === "edit" && f.quote && <p className="text-xs text-slate-500">Replaces only “<span className="font-medium text-ink">{f.quote}</span>”. Type the words that go in its place, not the whole sentence.</p>}
            <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === "edit" ? "Words to put in its place" : "Tell the reviewer why this is not a problem"} required />
            {preview && (
              <div className="rounded-lg border border-slate-200 p-2.5 text-sm" aria-live="polite">
                <p className="mb-1 text-xs text-slate-500">Your sentence will read:</p>
                <p>{preview.before}<span className="rounded bg-green-100 px-0.5 text-green-800">{preview.replacement || "…"}</span>{preview.after}</p>
              </div>
            )}
          <div className="flex gap-2"><button className="btn-primary" disabled={respond.isPending}>Save</button><button type="button" className="btn-secondary" onClick={() => setMode(null)}>Cancel</button></div>
        </form>
      ))}
      <ErrorNote error={respond.error} />
    </div>
  );
}
