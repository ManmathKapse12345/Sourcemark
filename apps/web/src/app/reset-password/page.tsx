"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, usingSupabase } from "@/lib/auth";
import { AuthLayout, Field, Notice } from "@/components/auth/AuthLayout";
import { PasswordInput } from "@/components/auth/PasswordInput";

/** Landing page for the link in the password-reset email (Supabase signs the user in for this step). */
export default function ResetPasswordPage() {
  const { updatePassword } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError("Choose a password with at least 8 characters.");
    if (password !== confirm) return setError("The two passwords don’t match.");
    setBusy(true); setError(undefined);
    try { await updatePassword(password); router.replace("/login?reset=1"); }
    catch (err) { setError((err as Error).message); setBusy(false); }
  }

  return (
    <AuthLayout>
      <div className="space-y-7">
        <div>
          <h1 className="!text-4xl">Choose a new password</h1>
          <p className="mt-1 text-slate-600">Use at least 8 characters. A short phrase is easier to remember than random symbols.</p>
        </div>
        {!usingSupabase && <Notice>This page opens from the link in a password-reset email. <Link href="/forgot-password" className="font-medium underline">Request a link</Link>.</Notice>}
        <form onSubmit={submit} className="space-y-4">
          <Field label="New password" id="password"><PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" meter /></Field>
          <Field label="Type it again" id="confirm"><PasswordInput id="confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" /></Field>
          {error && <Notice tone="error">{error}</Notice>}
          <button className="btn-primary w-full !py-2.5" disabled={busy || !usingSupabase}>{busy ? "Saving…" : "Save new password"}</button>
        </form>
      </div>
    </AuthLayout>
  );
}
