"use client";
import { useState } from "react";
import { useAuth } from "@/lib/auth";

export const SAMPLE_LOGIN = process.env.NEXT_PUBLIC_DEMO_LOGIN === "true";
const ROLES = [
  { role: "creator", name: "Chirag", label: "Creator", hint: "Writes content, fixes issues" },
  { role: "reviewer", name: "Ritu", label: "Reviewer", hint: "Checks drafts, asks for changes" },
  { role: "approver", name: "Arjun", label: "Approver", hint: "Gives final sign-off" },
  { role: "admin", name: "Asha", label: "Brand admin", hint: "Manages guidelines and team" },
];

/** One-click sign-in as the people in the Northfern Skincare sample workspace. */
export function SampleAccounts({ onError }: { onError: (e: unknown) => void }) {
  const { signIn } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  async function go(role: string) {
    setBusy(role); onError(undefined);
    try {
      const res = await fetch("/api/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "Could not sign in to the sample workspace");
      await signIn({ token: data.token });
    } catch (e) { onError(e); setBusy(null); }
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Explore the <span className="font-medium text-ink">Northfern Skincare</span> sample workspace as one of its team. Each person sees what their role allows.</p>
      <div className="grid grid-cols-2 gap-2">
        {ROLES.map((r) => (
          <button key={r.role} type="button" disabled={!!busy} onClick={() => void go(r.role)}
            className="rounded-xl border border-slate-200 bg-white/70 p-3 text-left transition hover:-translate-y-0.5 hover:border-brand disabled:opacity-50">
            <span className="block font-medium">{busy === r.role ? "Signing in…" : r.name} <span className="text-brand">· {r.label}</span></span>
            <span className="text-xs text-slate-500">{r.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
