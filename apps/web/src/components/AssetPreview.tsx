"use client";
import { useEffect, useState } from "react";
import { authenticatedBlobUrl } from "@/lib/api";
import type { Asset } from "@/lib/types";

export function AssetPreview({ orgId, asset }: { orgId: string; asset: Asset }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { if (!asset.hasImage) return; let url: string | null = null; authenticatedBlobUrl(`/orgs/${orgId}/assets/${asset.id}/image`).then((u) => { url = u; setSrc(u); }).catch(() => {}); return () => { if (url) URL.revokeObjectURL(url); }; }, [orgId, asset.id, asset.hasImage]);
  return src ? <img src={src} alt={asset.name} className="size-12 rounded-lg border border-slate-200 object-contain" /> : null;
}
