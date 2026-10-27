"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth, usingSupabase, EMAIL_OFF } from "@/lib/auth";
import { AuthLayout, Field, Notice } from "@/components/auth/AuthLayout";

function Forgot() {
  const { sendPasswordReset } = useAuth();
  const [email, setEmail] = useState(useSearchParams().get("email") ?? "");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(undefined);
    try { await sendPasswordReset(email); setSent(true); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  if (sent) return (
    <div className="space-y-5 text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-full bg-brand-soft text-2xl">✉</div>
      <h1 className="!text-4xl">Reset link sent</h1>
      <p className="text-slate-600">If an account exists for <span className="font-medium text-ink">{email}</span>, a link to choose a new password is on its way. It works once and expires in an hour.</p>
      <Link href="/login" className="btn-secondary">Back to sign in</Link>
    </div>
  );

  return (
    <div className="space-y-7">
      <div>
        <h1 className="!text-4xl">Forgot your password?</h1>
        <p className="mt-1 text-slate-600">Enter your work email and we’ll send you a link to choose a new one.</p>
      </div>
      {!usingSupabase && <Notice>{EMAIL_OFF}</Notice>}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Work email" id="email"><input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        {error && <Notice tone="error">{error}</Notice>}
        <button className="btn-primary w-full !py-2.5" disabled={busy || !usingSupabase}>{busy ? "Sending…" : "Send reset link"}</button>
      </form>
      <p className="text-center text-sm text-slate-600">Remembered it? <Link href="/login" className="font-medium text-brand hover:underline">Sign in</Link></p>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return <AuthLayout><Suspense><Forgot /></Suspense></AuthLayout>;
}
