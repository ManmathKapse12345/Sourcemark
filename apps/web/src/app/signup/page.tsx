"use client";
import Link from "next/link";
import { useState } from "react";
import { useAuth, usingSupabase, EMAIL_OFF } from "@/lib/auth";
import { AuthLayout, Field, Notice } from "@/components/auth/AuthLayout";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { SAMPLE_LOGIN } from "@/components/auth/SampleAccounts";

export default function SignupPage() {
  const { signUp } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError("Choose a password with at least 8 characters.");
    setBusy(true); setError(undefined);
    try { const r = await signUp({ name, email, password }); if (r.needsConfirmation) setSentTo(email); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  if (sentTo) return (
    <AuthLayout>
      <div className="space-y-5 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-brand-soft text-2xl">✉</div>
        <h1 className="!text-4xl">Check your inbox</h1>
        <p className="text-slate-600">We sent a confirmation link to <span className="font-medium text-ink">{sentTo}</span>. Open it to finish creating your account.</p>
        <p className="text-sm text-slate-500">Nothing arrived after a few minutes? Check spam, or <button className="text-brand hover:underline" onClick={() => setSentTo(null)}>try a different email</button>.</p>
        <Link href="/login" className="btn-secondary">Back to sign in</Link>
      </div>
    </AuthLayout>
  );

  return (
    <AuthLayout>
      <div className="space-y-7">
        <div>
          <h1 className="!text-4xl">Create your account</h1>
          <p className="mt-1 text-slate-600">Set up a workspace for your brand, or join your team’s.</p>
        </div>
        {!usingSupabase && <Notice>{EMAIL_OFF}{SAMPLE_LOGIN && <> <Link href="/login" className="font-medium underline">Open the sample workspace</Link>.</>}</Notice>}
        <form onSubmit={submit} className="space-y-4">
          <Field label="Your name" id="name"><input id="name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="Work email" id="email" hint={<span className="text-xs text-slate-500">Your admin adds you by this email</span>}>
            <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password" id="password"><PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" meter /></Field>
          <label className="flex items-start gap-2 text-sm text-slate-600">
            <input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} required />
            I understand that content I submit is checked against my organisation’s guidelines and may be sent to an AI service for judgement checks.
          </label>
          {error && <Notice tone="error">{error}</Notice>}
          <button className="btn-primary w-full !py-2.5" disabled={busy || !usingSupabase}>{busy ? "Creating account…" : "Create account"}</button>
        </form>
        <p className="text-center text-sm text-slate-600">Already have an account? <Link href="/login" className="font-medium text-brand hover:underline">Sign in</Link></p>
      </div>
    </AuthLayout>
  );
}
