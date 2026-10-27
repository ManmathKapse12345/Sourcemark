"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { CreateOrgBody } from "@sourcemark/contract";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AuthLayout, Field, Notice } from "@/components/auth/AuthLayout";

/** First sign-in with no organisation: start a workspace, or wait for an admin to add you. */
export default function OnboardingPage() {
  const { me, setOrgId, refreshMe, signOut } = useAuth();
  const router = useRouter();
  const [path, setPath] = useState<"create" | "join" | null>(null);
  const [name, setName] = useState("");
  const [checked, setChecked] = useState(false);
  const creating = useRef(false);
  useEffect(() => { if (me?.memberships.length && !creating.current) router.replace("/"); }, [me, router]);

  const create = useMutation({
    mutationFn: () => { creating.current = true; return api<{ org?: { id: string }; id?: string }>("/orgs", { body: CreateOrgBody.parse({ name }) }); },
    onError: () => { creating.current = false; },
    onSuccess: async (r) => { await refreshMe(); setOrgId(r.org?.id ?? r.id!); router.replace("/brand-kit"); },
  });
  const first = me?.user.name?.split(" ")[0];

  return (
    <AuthLayout>
      <div className="space-y-7">
        <div>
          <p className="text-sm text-slate-500">Step 1 of 2</p>
          <h1 className="!text-4xl">Welcome{first ? `, ${first}` : ""}</h1>
          <p className="mt-1 text-slate-600">You’re signed in as <span className="font-medium text-ink">{me?.user.email}</span>. How will you use Sourcemark?</p>
        </div>

        <div className="grid gap-3">
          {([
            ["create", "Set up my brand’s workspace", "You become its admin. Next you upload your guidelines and approved facts."],
            ["join", "Join my team’s workspace", "Your admin adds you by email and picks your role."],
          ] as const).map(([k, t, d]) => (
            <button key={k} type="button" onClick={() => setPath(k)} aria-pressed={path === k}
              className={`rounded-2xl border p-4 text-left transition ${path === k ? "border-brand bg-brand-soft" : "border-slate-200 bg-white/70 hover:border-slate-300"}`}>
              <span className="block font-medium">{t}</span><span className="text-sm text-slate-600">{d}</span>
            </button>
          ))}
        </div>

        {path === "create" && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <Field label="Brand or organisation name" id="org"><input id="org" className="input" placeholder="e.g. Northfern Skincare" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} /></Field>
            {create.error && <Notice tone="error">{(create.error as Error).message}</Notice>}
            <button className="btn-primary w-full !py-2.5" disabled={create.isPending}>{create.isPending ? "Creating workspace…" : "Create workspace"}</button>
          </form>
        )}

        {path === "join" && (
          <div className="space-y-4">
            <Notice>Send this email to your brand admin: <span className="font-mono font-medium">{me?.user.email}</span>. They add you under Team, and you get access straight away.</Notice>
            <button className="btn-secondary w-full" onClick={async () => { await refreshMe(); setChecked(true); }}>I’ve been added. Check again</button>
            {checked && !me?.memberships.length && <p className="text-center text-sm text-slate-500">Not added yet. Ask your admin to use exactly this email.</p>}
          </div>
        )}

        <p className="text-center text-sm text-slate-500">Wrong account? <button className="text-brand hover:underline" onClick={() => void signOut()}>Sign out</button></p>
      </div>
    </AuthLayout>
  );
}
