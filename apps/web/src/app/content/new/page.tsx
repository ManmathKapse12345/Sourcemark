"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Channel } from "@sourcemark/contract";
import Link from "next/link";
import { useAuth, useOrgApi } from "@/lib/auth";
import { ErrorNote } from "@/components/ui";

export default function NewContentPage() {
  const { can, orgId } = useAuth();
  const orgApi = useOrgApi();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [channel, setChannel] = useState<string>("instagram");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [aiChecks, setAiChecks] = useState(true);

  const rules = useQuery({
    queryKey: ["rules", orgId],
    queryFn: () => orgApi<{ rules: { type: string; active: boolean; message: string; config: { channels?: string[]; any_of?: string[]; at_start?: boolean } }[] }>("/rules"),
  });
  const disclosures = (rules.data?.rules ?? []).filter((r) => r.active && r.type === "required_disclosure" && (!r.config.channels?.length || r.config.channels.includes(channel)));
  const create = useMutation({
    mutationFn: () => {
      if (file) {
        const f = new FormData();
        f.append("title", title); f.append("channel", channel); f.append("aiChecks", String(aiChecks)); f.append("file", file);
        return orgApi<{ item: { id: string } }>("/content", { body: f });
      }
      return orgApi<{ item: { id: string } }>("/content", { body: { title, channel, body, aiChecks } });
    },
    onSuccess: (r) => router.push(`/content/${r.item?.id ?? (r as unknown as { id: string }).id}`),
  });

  if (!can("CREATOR")) return (
    <div className="card mx-auto max-w-xl space-y-3 text-center">
      <h1>Only creators can add content</h1>
      <p className="text-sm text-slate-600">Your role is to review or approve. Content written by creators shows up in your queue.</p>
      <Link href="/" className="btn-primary">Go to the review queue</Link>
    </div>
  );
  return (
    <form className="card mx-auto max-w-2xl space-y-3" onSubmit={(e) => { e.preventDefault(); if (!create.isPending && !create.isSuccess) create.mutate(); }}>
      <h1 className="text-xl font-semibold">New content</h1>
      <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <select className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
        {Channel.options.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
      </select>
      {disclosures.map((r, i) => (
        <p key={i} className="rounded-lg bg-brand-soft px-3 py-2 text-sm">
          <b>Heads up for {channel.replace("_", " ")}:</b> {r.message}{r.config.any_of?.length ? ` ${r.config.at_start ? "Start" : "Include"} the post with ${r.config.any_of.join(" or ")}.` : ""}
        </p>
      ))}
      {!file && <textarea className="input h-48" placeholder="Paste the text to review" value={body} onChange={(e) => setBody(e.target.value)} required />}
      <div className="text-sm">
        <label>Or upload a file (DOCX, PDF, TXT): <input type="file" accept=".docx,.pdf,.txt,.md" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={aiChecks} onChange={(e) => setAiChecks(e.target.checked)} />
        Use AI checks (uncheck to run rule checks only; nothing is sent to the LLM)
      </label>
      <ErrorNote error={create.error} />
      <button className="btn-primary" disabled={create.isPending || create.isSuccess}>{create.isPending ? "Creating…" : "Create draft"}</button>
    </form>
  );
}
