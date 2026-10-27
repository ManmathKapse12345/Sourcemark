"use client";
import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, useOrgApi } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import type { ContentDetail } from "@/lib/types";
import { ErrorNote, Loading, StateBadge } from "@/components/ui";
import { Verdict } from "@/components/Verdict";
import { HighlightedBody } from "@/components/HighlightedBody";
import { FindingCard } from "@/components/FindingCard";

const ACTION_LABEL: Record<string, string> = {
  SUBMIT: "Check & send for review", RESOLVE: "Send to approver", REVISE: "Edit again", REQUEST_CHANGES: "Ask for changes", APPROVE: "Approve for publishing", REJECT: "Reject",
};
const EVENT_LABEL: Record<string, string> = {
  SUBMIT: "Sent for checks", RESOLVE: "Sent to a reviewer", REQUEST_CHANGES: "Changes requested", APPROVE: "Approved for publishing", REJECT: "Rejected", REVISE: "Reopened for editing",
};
const NOTE_REQUIRED = new Set(["REQUEST_CHANGES", "REJECT"]);

export default function ContentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const orgApi = useOrgApi();
  const qc = useQueryClient();
  const { memberId } = useAuth();
  const [active, setActive] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const key = ["content-detail", id];
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const q = useQuery({ queryKey: key, queryFn: () => orgApi<ContentDetail>(`/content/${id}`) });
  const transition = useMutation({
    mutationFn: (action: string) => orgApi(`/content/${id}/transitions`, { body: { action, note: note || undefined } }),
    onSuccess: () => { setNote(""); void refresh(); },
  });
  const applyFixes = useMutation({
    mutationFn: () => orgApi(`/content/${id}/versions`, { body: { applyResponses: true } }),
    onSuccess: refresh,
  });
  const saveText = useMutation({
    mutationFn: () => orgApi(`/content/${id}/versions`, { body: { body: draft } }),
    onSuccess: () => { setDraft(null); void refresh(); },
  });
  const addComment = useMutation({
    mutationFn: () => orgApi(`/content/${id}/comments`, { body: { body: comment, findingId: active ?? undefined } }),
    onSuccess: () => { setComment(""); void refresh(); },
  });

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} />;
  const d = q.data;
  const version = d.versions[0];
  const run = d.latestRun;
  const findings = run?.findings ?? [];
  const isAuthor = d.author.memberId === memberId;
  const canRespond = d.item.state === "IN_REVIEW" ? !isAuthor : isAuthor && ["DRAFT", "CHECKING"].includes(d.item.state);
  const needNote = d.availableActions.some((a) => NOTE_REQUIRED.has(a));

  const select = (fid: string) => { setActive(fid); document.getElementById(`finding-${fid}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-500">{d.item.channel.replace("_", " ")} · written by {d.author.name ?? d.author.email} · version {version.number}</p>
        <h1>{d.item.title}</h1>
      </div>
      <Verdict d={d} />

      {run?.aiStatus === "unavailable" && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">AI checks were unavailable for this run ({run.aiError ?? "unknown reason"}). Only rule and fact checks were applied.</p>}
      {run?.aiStatus === "disabled" && <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">AI checks are off for this content. Rule and fact checks only.</p>}
      {run?.status === "FAILED" && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">The last check failed. Re-run it from the actions below.</p>}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {draft !== null ? (
            <div className="card !p-6 space-y-3">
              <h2 className="text-sm font-semibold">Edit the text</h2>
              <textarea className="input min-h-40 !text-[17px] !leading-8" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Content text" />
              <div className="flex gap-2">
                <button className="btn-primary" disabled={saveText.isPending || !draft.trim()} onClick={() => saveText.mutate()}>{saveText.isPending ? "Saving and re-checking…" : "Save as new version"}</button>
                <button className="btn-secondary" onClick={() => setDraft(null)}>Cancel</button>
              </div>
              <ErrorNote error={saveText.error} />
            </div>
          ) : <div className="card !p-6 space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              <h2 className="mr-auto text-sm font-semibold text-ink">The content</h2>
              <span><mark className="rounded bg-red-200 px-1 text-ink underline decoration-wavy decoration-red-700 underline-offset-4">wavy red</mark> breaks a rule or fact</span>
              <span><mark className="rounded bg-amber-200 px-1 text-ink underline decoration-dotted decoration-amber-800 decoration-2 underline-offset-4">dotted gold</mark> needs a person to confirm</span>
              <span>Click any highlight</span>
              {isAuthor && ["DRAFT", "CHECKING"].includes(d.item.state) && <button className="btn-secondary !py-1 !text-xs" onClick={() => setDraft(version.body)}>Edit the text</button>}
            </div>
            <HighlightedBody body={version.body} findings={findings} activeId={active} onSelect={select} />
          </div>}

          {run && run.rewrites.length > 0 && (
            <div className="card space-y-2">
              <h2 className="text-sm font-semibold">Smoother rewrites suggested</h2>
              {run.rewrites.map((r) => (
                <div key={r.key} className="text-sm"><p className="text-slate-500 line-through">{r.original}</p><p>{r.text}</p></div>
              ))}
            </div>
          )}

          <div className="card space-y-3">
            <h2 className="text-sm font-semibold">What would you like to do?</h2>
            {needNote && <textarea className="input" placeholder="Add a note for the writer (needed to ask for changes or reject)" value={note} onChange={(e) => setNote(e.target.value)} />}
            <div className="flex flex-wrap gap-2">
              {d.availableActions.map((a) => (
                <button key={a} title={a === "RESOLVE" && d.blockingFindingIds.length ? "Fix the open problems first" : undefined}
                  disabled={transition.isPending || (NOTE_REQUIRED.has(a) && !note.trim()) || (a === "RESOLVE" && d.blockingFindingIds.length > 0)}
                  className={a === "REJECT" ? "btn-danger" : a === "REQUEST_CHANGES" ? "btn-secondary" : "btn-primary"} onClick={() => transition.mutate(a)}>
                  {ACTION_LABEL[a] ?? a}
                </button>
              ))}
              {isAuthor && ["DRAFT", "CHECKING"].includes(d.item.state) && (
                <button className="btn-secondary" disabled={applyFixes.isPending} onClick={() => applyFixes.mutate()}>Apply accepted fixes as new version</button>
              )}
              {!d.availableActions.length && <p className="text-sm text-slate-500">{d.item.state === "APPROVED" ? "Nothing left to do. This content is approved and ready to publish." : d.item.state === "REJECTED" ? "This content was rejected and is closed." : "Nothing for you to do right now. It is with someone else."}</p>}
            </div>
            <ErrorNote error={transition.error ?? applyFixes.error} />
            {d.blockingFindingIds.length > 0 && <p className="text-sm text-slate-500">{d.blockingFindingIds.length} {d.blockingFindingIds.length === 1 ? "problem is" : "problems are"} still open. Choose a fix for each one and press “Apply accepted fixes as new version”, or use “Edit the text”. Sourcemark re-checks the new version, and problems close only when they are really gone.</p>}
          </div>

          <div className="card space-y-3">
            <h2 className="text-sm font-semibold">Discussion</h2>
            {d.comments.map((c) => <p key={c.id} className="text-sm"><span className="text-xs text-slate-500">{fmtDate(c.createdAt)}</span><br />{c.body}</p>)}
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addComment.mutate(); }}>
              <input className="input" placeholder={active ? "Comment on selected finding" : "Add a comment"} value={comment} onChange={(e) => setComment(e.target.value)} required />
              <button className="btn-secondary" disabled={addComment.isPending}>Post</button>
            </form>
            <ErrorNote error={addComment.error} />
          </div>

          <div className="card">
            <h2 className="mb-2 text-sm font-semibold">Timeline</h2>
            <ul className="space-y-1 text-sm">
              {d.events.map((e, i) => <li key={i}><span className="text-xs text-slate-500">{fmtDate(e.createdAt)}</span> {EVENT_LABEL[e.action] ?? e.action.toLowerCase().replace(/_/g, " ")}{e.note ? ` — ${e.note}` : ""}</li>)}
            </ul>
          </div>
        </div>

        <aside className="space-y-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
          <h2 className="text-sm font-semibold">What Sourcemark found <span className="text-slate-500">({findings.length})</span></h2>
          {findings.length === 0 && <p className="text-sm text-slate-500">{run ? "Nothing to fix here." : "Not checked yet. Choose “Check & send for review”."}</p>}
          {findings.map((f) => (
            <FindingCard key={f.id} f={f} active={active === f.id} canRespond={canRespond} contentId={id} onSelect={() => setActive(f.id)} />
          ))}
        </aside>
      </div>
    </div>
  );
}
