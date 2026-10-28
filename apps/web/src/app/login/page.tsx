"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useAuth, usingSupabase } from "@/lib/auth";
import { AuthLayout, Field, Notice } from "@/components/auth/AuthLayout";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { SampleAccounts, SAMPLE_LOGIN } from "@/components/auth/SampleAccounts";

function Login() {
  const { signIn, me } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (me) router.replace("/"); }, [me, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(undefined);
    try { await signIn(usingSupabase ? { email, password } : { token }); } catch (err) { setError(err); setBusy(false); }
  }

  return (
    <div className="space-y-7">
      <div>
        <h1 className="!text-4xl">Welcome back</h1>
        <p className="mt-1 text-slate-600">Sign in to review content against your guidelines.</p>
      </div>
      {params.get("confirmed") && <Notice tone="ok">Your email is confirmed. Sign in to set up your workspace.</Notice>}
      {params.get("reset") && <Notice tone="ok">Your password is updated. Sign in with the new one.</Notice>}

      {usingSupabase ? (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Work email" id="email"><input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Password" id="password" hint={<Link href={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ""}`} className="text-xs text-brand hover:underline">Forgot password?</Link>}>
            <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
          </Field>
          {error ? <Notice tone="error">{(error as Error).message}</Notice> : null}
          <button className="btn-primary w-full !py-2.5" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      ) : (
        error ? <Notice tone="error">{(error as Error).message}</Notice> : null
      )}

      {SAMPLE_LOGIN && (
        <div id="demo" className="scroll-mt-6 space-y-7">
          {usingSupabase && <p className="flex items-center gap-3 text-xs text-slate-500"><span className="h-px flex-1 bg-slate-200" />or use a demo login<span className="h-px flex-1 bg-slate-200" /></p>}
          <SampleAccounts onError={setError} />
        </div>
      )}

      {!usingSupabase && (
        <details className="rounded-xl border border-slate-200 p-4 text-sm">
          <summary className="cursor-pointer text-slate-600">Developer sign-in with an access token</summary>
          <form onSubmit={submit} className="mt-3 space-y-3">
            <textarea className="input h-24 font-mono text-xs" placeholder="Paste access token" value={token} onChange={(e) => setToken(e.target.value)} required aria-label="Access token" />
            <p className="text-xs text-slate-500">Create one with <code>npm run token -- creator@northfern.test</code>.</p>
            <button className="btn-secondary w-full" disabled={busy}>Continue with token</button>
          </form>
        </details>
      )}

      <p className="text-center text-sm text-slate-600">New to Sourcemark? <Link href="/signup" className="font-medium text-brand hover:underline">Create an account</Link></p>
    </div>
  );
}

export default function LoginPage() {
  return <AuthLayout><Suspense><Login /></Suspense></AuthLayout>;
}
