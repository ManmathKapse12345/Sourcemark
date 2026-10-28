"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Role } from "@sourcemark/contract";
import { api, configureApi } from "./api";
import type { Me } from "./types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TOKEN_KEY = "sourcemark.devToken";
const ORG_KEY = "sourcemark.orgId";

export const usingSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);
export const EMAIL_OFF = "Email accounts are not switched on for this workspace yet. Use a sample account to look around.";

/** Supabase error messages, rewritten for people. */
function friendly(msg: string) {
  const m = msg.toLowerCase();
  if (m.includes("invalid login")) return "That email and password don't match. Check for typos, or reset your password.";
  if (m.includes("email not confirmed")) return "Please confirm your email first. We sent you a link when you signed up.";
  if (m.includes("already registered")) return "An account with this email already exists. Sign in instead.";
  if (m.includes("password should be")) return "Choose a longer password: at least 8 characters.";
  if (m.includes("rate limit")) return "Too many attempts. Wait a minute and try again.";
  return msg;
}

async function supabase() {
  const { createClient } = await import("@supabase/supabase-js");
  return (supabase.client ??= createClient(SUPABASE_URL!, SUPABASE_KEY!));
}
supabase.client = undefined as ReturnType<typeof import("@supabase/supabase-js").createClient> | undefined;

// A stored token (sample accounts, developer sign-in) is used when there is no Supabase session.
async function currentToken(): Promise<string | null> {
  const session = usingSupabase ? (await (await supabase()).auth.getSession()).data.session?.access_token : null;
  return session ?? localStorage.getItem(TOKEN_KEY);
}

type AuthCtx = {
  me: Me | undefined;
  loading: boolean;
  orgId: string | null;
  setOrgId: (id: string) => void;
  roles: Role[];
  memberId: string | null;
  can: (...r: Role[]) => boolean;
  signIn: (a: { email?: string; password?: string; token?: string }) => Promise<void>;
  signUp: (a: { name: string; email: string; password: string }) => Promise<{ needsConfirmation: boolean }>;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  refreshMe: () => Promise<unknown>;
  signOut: () => Promise<void>;
};
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [orgId, setOrg] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [hasToken, setHasToken] = useState(false);

  const signOut = useCallback(async () => {
    if (usingSupabase) await (await supabase()).auth.signOut();
    localStorage.removeItem(TOKEN_KEY);
    setHasToken(false);
    qc.clear();
    router.replace("/login");
  }, [qc, router]);

  useEffect(() => {
    configureApi({ getToken: currentToken, onUnauthenticated: () => void signOut() });
    setOrg(localStorage.getItem(ORG_KEY));
    currentToken().then((t) => { setHasToken(!!t); setReady(true); });
    if (usingSupabase) void supabase().then((c) => c.auth.onAuthStateChange((event, session) => {
      setHasToken(!!session || !!localStorage.getItem(TOKEN_KEY));
      if (event === "PASSWORD_RECOVERY") router.replace("/reset-password");
    }));
  }, [signOut, router]);

  const meQ = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me"), enabled: ready && hasToken });
  const me = meQ.data;

  useEffect(() => {
    if (!me) return;
    const first = me.memberships[0]?.org.id ?? null;
    if (!orgId || !me.memberships.some((m) => m.org.id === orgId)) setOrg(first);
  }, [me, orgId]);

  const membership = me?.memberships.find((m) => m.org.id === orgId);
  const roles = membership?.roles ?? [];

  const value = useMemo<AuthCtx>(() => ({
    me,
    loading: !ready || (hasToken && meQ.isLoading),
    orgId,
    setOrgId: (id) => { localStorage.setItem(ORG_KEY, id); setOrg(id); qc.invalidateQueries(); },
    roles,
    memberId: membership?.memberId ?? null,
    can: (...r) => r.some((x) => roles.includes(x)),
    signIn: async ({ email, password, token }) => {
      if (token) {
        if (usingSupabase) await (await supabase()).auth.signOut();
        localStorage.setItem(TOKEN_KEY, token.trim());
      } else if (usingSupabase) {
        const { error } = await (await supabase()).auth.signInWithPassword({ email: email!, password: password! });
        if (error) throw new Error(friendly(error.message));
        localStorage.removeItem(TOKEN_KEY);
      }
      setHasToken(true);
      await qc.invalidateQueries({ queryKey: ["me"] });
      router.replace("/");
    },
    signUp: async ({ name, email, password }) => {
      if (!usingSupabase) throw new Error(EMAIL_OFF);
      const { data, error } = await (await supabase()).auth.signUp({
        email, password, options: { data: { full_name: name }, emailRedirectTo: `${location.origin}/login?confirmed=1` },
      });
      if (error) throw new Error(friendly(error.message));
      if (data.session) { setHasToken(true); await qc.invalidateQueries({ queryKey: ["me"] }); router.replace("/"); }
      return { needsConfirmation: !data.session };
    },
    sendPasswordReset: async (email) => {
      if (!usingSupabase) throw new Error(EMAIL_OFF);
      const { error } = await (await supabase()).auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset-password` });
      if (error) throw new Error(friendly(error.message));
    },
    updatePassword: async (password) => {
      if (!usingSupabase) throw new Error(EMAIL_OFF);
      const { error } = await (await supabase()).auth.updateUser({ password });
      if (error) throw new Error(friendly(error.message));
      setHasToken(true);
      await qc.invalidateQueries({ queryKey: ["me"] });
    },
    refreshMe: () => qc.invalidateQueries({ queryKey: ["me"] }),
    signOut,
  }), [me, ready, hasToken, meQ.isLoading, orgId, roles, membership, qc, router, signOut]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}

/** Org-scoped path: orgPath("/content") -> "/orgs/<id>/content" */
export function useOrgApi() {
  const { orgId } = useAuth();
  return useCallback(<T,>(path: string, init?: { method?: string; body?: unknown }) => api<T>(`/orgs/${orgId}${path}`, init), [orgId]);
}
