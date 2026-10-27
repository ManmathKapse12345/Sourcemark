"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Channel } from "@sourcemark/contract";
import Link from "next/link";
import { useAuth, useOrgApi } from "@/lib/auth";
import { ErrorNote } from "@/components/ui";

export default function NewContentPage() {
  const { can } = useAuth();
  const orgApi = useOrgApi();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [channel, setChannel] = useState<string>("instagram");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [aiChecks, setAiChecks] = useState(true);

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
    <form className="card mx-auto max-w-2xl space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
      <h1 className="text-xl font-semibold">New content</h1>
      <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <select className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
        {Channel.options.map((c) => <option key={c}>{c}</option>)}
      </select>
      {!file && <textarea className="input h-48" placeholder="Paste the text to review" value={body} onChange={(e) => setBody(e.target.value)} required />}
      <div className="text-sm">
        <label>Or upload a file (DOCX, PDF, TXT): <input type="file" accept=".docx,.pdf,.txt,.md" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={aiChecks} onChange={(e) => setAiChecks(e.target.checked)} />
        Use AI checks (uncheck to run rule checks only; nothing is sent to the LLM)
      </label>
      <ErrorNote error={create.error} />
      <button className="btn-primary" disabled={create.isPending}>{create.isPending ? "Creating…" : "Create draft"}</button>
    </form>
  );
}
