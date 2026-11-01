"use client";
import { useEffect, useState } from "react";
import { authenticatedBlobUrl } from "@/lib/api";
import type { Finding } from "@/lib/types";
import { ErrorNote, Loading } from "./ui";

export function ImageReview({ orgId, contentId, versionId, findings, activeId, onSelect }: { orgId: string; contentId: string; versionId: string; findings: Finding[]; activeId: string | null; onSelect: (id: string) => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    authenticatedBlobUrl(`/orgs/${orgId}/content/${contentId}/versions/${versionId}/image`).then((u) => { url = u; if (alive) setSrc(u); }).catch(setError);
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [orgId, contentId, versionId]);
  if (error) return <ErrorNote error={error} />;
  if (!src) return <Loading />;
  return <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
    <img src={src} alt="Uploaded content" className="block max-h-[620px] max-w-full object-contain" />
    {findings.filter((f) => f.boxX != null && f.boxY != null && f.boxW != null && f.boxH != null && f.status !== "CLOSED" && f.status !== "SUPERSEDED").map((f) => {
      const needs = f.kind === "needs_human_check";
      return <button key={f.id} type="button" aria-label={`Finding: ${f.quote ?? f.category}`} onClick={() => onSelect(f.id)} className={`absolute rounded-sm border-2 ${needs ? "border-amber-700 bg-amber-200/20" : "border-red-700 bg-red-200/20"} ${activeId === f.id ? "z-10 ring-4 ring-brand" : ""}`} style={{ left: `${f.boxX! * 100}%`, top: `${f.boxY! * 100}%`, width: `${f.boxW! * 100}%`, height: `${f.boxH! * 100}%` }} />;
    })}
  </div>;
}
