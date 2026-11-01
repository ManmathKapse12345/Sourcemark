"use client";
import { useEffect, useState } from "react";
import { authenticatedBlobUrl } from "@/lib/api";
import { ErrorNote, Loading } from "./ui";

export function ImageCompare({ orgId, contentId, currentVersionId, previousVersionId, currentAlt, previousAlt }: { orgId: string; contentId: string; currentVersionId: string; previousVersionId: string; currentAlt?: string | null; previousAlt?: string | null }) {
  const [urls, setUrls] = useState<[string, string] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let alive = true;
    let created: string[] = [];
    Promise.all([currentVersionId, previousVersionId].map((v) => authenticatedBlobUrl(`/orgs/${orgId}/content/${contentId}/versions/${v}/image`))).then((u) => { created = u; if (alive) setUrls([u[0], u[1]]); }).catch(setError);
    return () => { alive = false; created.forEach((u) => URL.revokeObjectURL(u)); };
  }, [orgId, contentId, currentVersionId, previousVersionId]);
  if (error) return <ErrorNote error={error} />;
  if (!urls) return <Loading />;
  return <div className="grid gap-3 sm:grid-cols-2"><div><p className="mb-2 text-xs font-medium text-slate-500">Previous</p><img src={urls[1]} alt="Previous version" className="max-h-80 w-full rounded-lg border border-slate-200 object-contain" /><p className="mt-2 text-xs text-slate-500">Alt text: {previousAlt || "None"}</p></div><div><p className="mb-2 text-xs font-medium text-slate-500">Current</p><img src={urls[0]} alt="Current version" className="max-h-80 w-full rounded-lg border border-slate-200 object-contain" /><p className="mt-2 text-xs text-slate-500">Alt text: {currentAlt || "None"}</p></div></div>;
}
