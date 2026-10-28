"use client";
import { use, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, useOrgApi } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { diffWords } from "@/lib/diff";
import type { AuditEntry, ContentDetail, Member, Run } from "@/lib/types";
import { ErrorNote, Loading } from "@/components/ui";
import { Verdict } from "@/components/Verdict";
import { HighlightedBody } from "@/components/HighlightedBody";
import { FindingCard } from "@/components/FindingCard";
import { CheckingPanel } from "@/components/CheckingPanel";

const ACTION_LABEL: Record<string, string> = {
  SUBMIT: "Check & send for review", RESOLVE: "Send for review", REVISE: "Edit again", REQUEST_CHANGES: "Ask for changes", APPROVE: "Approve for publishing", REJECT: "Reject",
};
const AUDIT_LABEL: Record<string, string> = {
  "content.created": "Created the draft", "content.version_created": "Saved a new version", "content.submitted": "Sent it for checks",
  "content.transition": "Moved it on", "content.analyzed": "Ran the checks", "comment.added": "Commented",
  "finding.response": "Answered a finding", "finding.responded": "Answered a finding", "finding.closed": "A problem was fixed",
};
const NOTE_REQUIRED = new Set(["REQUEST_CHANGES", "REJECT"]);
const CHECK_ACTIONS = new Set(["SUBMIT"]);
// A check still running on the server (started in another tab, or before a reload). Past the API's
// own timeout a RUNNING run is stuck, so stop waiting for it.
const STUCK_AFTER_MS = 4 * 60_000;
const stillRunning = (run?: Run | null) => run?.status === "RUNNING" && Date.now() - Date.parse(run.createdAt) < STUCK_AFTER_MS;

export default function ContentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const orgApi = useOrgApi();
  const qc = useQueryClient();
  const { memberId, orgId } = useAuth();
  const [active, setActive] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [tab, setTab] = useState<"discussion" | "history" | "changes">("discussion");
  const key = ["content-detail", id];
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const q = useQuery({
    queryKey: key,
    queryFn: () => orgApi<ContentDetail>(`/content/${id}`),
    refetchInterval: (query) => (stillRunning(query.state.data?.latestRun) ? 3000 : false),
  });
  const members = useQuery({ queryKey: ["members", orgId], queryFn: () => orgApi<{ members: Member[] }>("/") });
  const audit = useQuery({ queryKey: ["content-audit", id], queryFn: () => orgApi<{ entries: AuditEntry[] }>(`/content/${id}/audit`), enabled: tab === "history" });

  const after = () => { void refresh(); void qc.invalidateQueries({ queryKey: ["content-audit", id] }); };
  const transition = useMutation({
    mutationFn: (action: string) => orgApi(`/content/${id}/transitions`, { body: { action, note: note || undefined } }),
    onSuccess: () => { setNote(""); after(); },
    onError: after,
  });
  const newVersion = useMutation({
    mutationFn: (body: object) => orgApi(`/content/${id}/versions`, { body }),
    onSuccess: () => { setDraft(null); after(); },
    onError: after,
  });
  const recheck = useMutation({ mutationFn: () => orgApi(`/content/${id}/analyze`, { method: "POST", body: {} }), onSettled: after });
  const addComment = useMutation({
    mutationFn: () => orgApi(`/content/${id}/comments`, { body: { body: comment, findingId: active ?? undefined } }),
    onSuccess: () => { setComment(""); after(); },
  });

  // Errors belong to the version they happened on: clear them when a new version arrives (item 5).
  const versionId = q.data?.versions[0]?.id;
  useEffect(() => { transition.reset(); newVersion.reset(); recheck.reset(); setActive(null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [versionId]);

  const names = useMemo(() => new Map(members.data?.members.map((m) => [m.id, m.name ?? m.email]) ?? []), [members.data]);

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} />;
  const d = q.data;
  const version = d.versions[0];
  const previous = d.versions[1];
  const run = d.latestRun;
  const findings = run?.findings ?? [];
  const isAuthor = d.author.memberId === memberId;
  const editable = isAuthor && ["DRAFT", "CHECKING"].includes(d.item.state);
  const canRespond = d.item.state === "IN_REVIEW" ? !isAuthor : editable;
  const needNote = d.availableActions.some((a) => NOTE_REQUIRED.has(a));
  const checking = newVersion.isPending || recheck.isPending || (transition.isPending && CHECK_ACTIONS.has(transition.variables ?? "")) || stillRunning(run);
  const runBroken = run?.status === "FAILED";
  const open = d.blockingFindingIds.length;

  const disabledReason = (a: string) =>
    a === "RESOLVE" && open ? `${open} ${open === 1 ? "problem is" : "problems are"} still open` :
    a === "RESOLVE" && runBroken ? "The last check didn't finish. Re-check first" :
    NOTE_REQUIRED.has(a) && !note.trim() ? "Add a note for the writer first" : null;

  const select = (fid: string) => { setActive(fid); document.getElementById(`finding-${fid}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-500">{d.item.channel.replace("_", " ")} · written by {d.author.name ?? d.author.email} · version {version.number}</p>
        <h1>{d.item.title}</h1>
      </div>

      {checking ? <CheckingPanel /> : <Verdict d={d} />}

      {/* Why a check is incomplete (item 4), with a way to run it again (item 3). */}
      {!checking && (runBroken || run?.aiStatus === "unavailable") && (
        <div className={`flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 text-sm ${runBroken ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>
          <span className="min-w-0 flex-1">
            {runBroken
              ? <><b>The check didn’t finish</b>, so these results are incomplete. {run?.aiError ? `Reason: ${run.aiError}.` : "It may have timed out."}</>
              : <><b>AI checks were unavailable</b> ({run?.aiError ?? "unknown reason"}). Only rule and fact checks ran, so judgement calls like tone and claims were not reviewed.</>}
          </span>
          {editable && d.item.state === "CHECKING" && (
            <button className="btn-secondary" disabled={recheck.isPending} onClick={() => recheck.mutate()}>Re-check</button>
          )}
        </div>
      )}
      {run?.aiStatus === "disabled" && <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">AI checks are off for this content. Rule and fact checks only.</p>}
      <ErrorNote error={recheck.error} />

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-4">
          {draft !== null ? (
            <div className="card space-y-3 !p-6">
              <h2 className="text-sm font-semibold">Edit the text</h2>
              <textarea className="input min-h-40 !text-[17px] !leading-8" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Content text" />
              <div className="flex gap-2">
                <button className="btn-primary" disabled={newVersion.isPending || !draft.trim() || draft === version.body} onClick={() => newVersion.mutate({ body: draft })}>Save as new version</button>
                <button className="btn-secondary" onClick={() => setDraft(null)}>Cancel</button>
              </div>
              {draft === version.body && <p className="text-xs text-slate-500">Change something to save a new version.</p>}
              <ErrorNote error={newVersion.error} />
            </div>
          ) : (
            <div className="card space-y-4 !p-6">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                <h2 className="mr-auto text-sm font-semibold text-ink">The content</h2>
                <span><mark className="rounded bg-red-200 px-1 text-ink underline decoration-wavy decoration-red-700 underline-offset-4">wavy red</mark> breaks a rule or fact</span>
                <span><mark className="rounded bg-amber-200 px-1 text-ink underline decoration-dotted decoration-2 decoration-amber-800 underline-offset-4">dotted gold</mark> needs a person to confirm</span>
                {editable && <button className="btn-secondary !py-1 !text-xs" onClick={() => setDraft(version.body)}>Edit the text</button>}
              </div>
              <HighlightedBody body={version.body} findings={findings} activeId={active} onSelect={select} />
            </div>
          )}

          {run && run.rewrites.length > 0 && (
            <div className="card space-y-3">
              <h2 className="text-sm font-semibold">Smoother rewrites suggested</h2>
              {run.rewrites.map((r) => (
                <div key={r.key} className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
                  <p className="text-slate-500 line-through">{r.original}</p>
                  <p>{r.text}</p>
                  {editable && <button className="btn-primary !py-1 !text-xs" disabled={newVersion.isPending} onClick={() => newVersion.mutate({ applyRewriteIds: [r.key] })}>Use this rewrite</button>}
                </div>
              ))}
              <ErrorNote error={newVersion.error} />
            </div>
          )}

          <div className="card space-y-3">
            <h2 className="text-sm font-semibold">What would you like to do?</h2>
            {needNote && <textarea className="input" placeholder="Add a note for the writer (needed to ask for changes or reject)" value={note} onChange={(e) => setNote(e.target.value)} />}
            <div className="flex flex-wrap items-start gap-2">
              {d.availableActions.map((a) => {
                const why = disabledReason(a);
                return (
                  <div key={a} className="space-y-1">
                    <button disabled={transition.isPending || checking || !!why}
                      className={a === "REJECT" ? "btn-danger" : a === "REQUEST_CHANGES" ? "btn-secondary" : "btn-primary"} onClick={() => transition.mutate(a)}>
                      {ACTION_LABEL[a] ?? a}
                    </button>
                    {why && <p className="text-xs text-slate-500">{why}</p>}
                  </div>
                );
              })}
              {editable && (
                <button className="btn-secondary" disabled={newVersion.isPending} onClick={() => newVersion.mutate({ applyResponses: true })}>Apply accepted fixes as new version</button>
              )}
              {!d.availableActions.length && <p className="text-sm text-slate-500">{d.item.state === "APPROVED" ? "Nothing left to do. This content is approved and ready to publish." : d.item.state === "REJECTED" ? "This content was rejected and is closed." : "Nothing for you to do right now. It is with someone else."}</p>}
            </div>
            <ErrorNote error={transition.error ?? (draft === null ? newVersion.error : null)} />
            {open > 0 && editable && <p className="text-sm text-slate-500">Choose a fix for each problem and press “Apply accepted fixes as new version”, or use “Edit the text”. Sourcemark re-checks the new version, and problems close only when they are really gone.</p>}
          </div>

          <div className="card space-y-3">
            <div role="tablist" className="flex gap-1 border-b border-slate-200">
              {([["discussion", `Discussion (${d.comments.length})`], ["history", "History"], ...(previous ? [["changes", `Changes since v${previous.number}`]] : [])] as [typeof tab, string][]).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={`-mb-px px-3 py-2 text-sm ${tab === k ? "border-b-2 border-brand font-medium" : "text-slate-500 hover:text-ink"}`}>{l}</button>
              ))}
            </div>

            {tab === "discussion" && (
              <>
                {d.comments.map((c) => <p key={c.id} className="text-sm"><span className="text-xs text-slate-500">{names.get(c.memberId) ?? "Someone"} · {fmtDate(c.createdAt)}</span><br />{c.body}</p>)}
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addComment.mutate(); }}>
                  <input className="input" placeholder={active ? "Comment on the selected finding" : "Write a comment"} value={comment} onChange={(e) => setComment(e.target.value)} required />
                  <button className="btn-secondary" disabled={addComment.isPending}>Post</button>
                </form>
                <ErrorNote error={addComment.error} />
              </>
            )}

            {tab === "history" && (
              audit.isLoading ? <Loading /> : (
                <ol className="space-y-2 text-sm">
                  {audit.data?.entries.map((e) => {
                    const data = (e.data ?? {}) as Record<string, unknown>;
                    const extra = typeof data.to === "string" ? `→ ${String(data.to).toLowerCase().replace(/_/g, " ")}` : typeof data.number === "number" ? `v${data.number}` : typeof data.action === "string" ? String(data.action).toLowerCase() : "";
                    return (
                      <li key={e.id} className="flex flex-wrap gap-x-2">
                        <span className="w-36 shrink-0 text-xs text-slate-500">{fmtDate(e.createdAt)}</span>
                        <span className="font-medium">{e.actorId ? names.get(e.actorId) ?? "Someone" : "Sourcemark"}</span>
                        <span>{AUDIT_LABEL[e.action] ?? e.action.replace(/[._]/g, " ")} {extra}</span>
                      </li>
                    );
                  })}
                  <ErrorNote error={audit.error} />
                </ol>
              )
            )}

            {tab === "changes" && previous && (
              <p className="whitespace-pre-wrap text-[15px] leading-8">
                {diffWords(previous.body, version.body).map((p, i) =>
                  p.type === "same" ? <span key={i}>{p.text}</span>
                  : p.type === "del" ? <del key={i} className="rounded bg-red-100 px-0.5 text-red-800">{p.text}</del>
                  : <ins key={i} className="rounded bg-green-100 px-0.5 text-green-800 no-underline">{p.text}</ins>)}
              </p>
            )}
          </div>
        </div>

        <aside className="space-y-3 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
          <h2 className="text-sm font-semibold">What Sourcemark found <span className="text-slate-500">({findings.length})</span></h2>
          {findings.length === 0 && (
            <p className="text-sm text-slate-500">
              {!run ? "Not checked yet. Choose “Check & send for review”." : checking ? "Checking…" : runBroken ? "No results, because the check didn’t finish." : "Nothing to fix here."}
            </p>
          )}
          {findings.map((f) => (
            <FindingCard key={f.id} f={f} body={version.body} active={active === f.id} canRespond={canRespond} contentId={id}
              showDispute={!isAuthor} onSelect={() => setActive(f.id)} />
          ))}
        </aside>
      </div>
    </div>
  );
}
