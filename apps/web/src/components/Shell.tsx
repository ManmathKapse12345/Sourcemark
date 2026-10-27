"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Loading } from "./ui";
import { ThemeToggle } from "./ThemeToggle";

const PUBLIC = ["/welcome", "/login", "/signup", "/forgot-password", "/reset-password"];

export function Shell({ children }: { children: React.ReactNode }) {
  const { me, loading, orgId, setOrgId, can, signOut } = useAuth();
  const path = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC.includes(path);
  const noOrgYet = !!me && me.memberships.length === 0;

  useEffect(() => {
    if (loading) return;
    if (!me && !isPublic) router.replace("/welcome");
    else if (noOrgYet && path !== "/onboarding" && !isPublic) router.replace("/onboarding");
  }, [loading, me, isPublic, noOrgYet, path, router]);

  if (isPublic || path === "/onboarding") return <>{children}</>;
  if (loading || !me) return <div className="p-8"><Loading /></div>;

  const nav = [
    { href: "/", label: "Dashboard" },
    { href: "/brand-kit", label: "Brand kit" },
    ...(can("ADMIN") ? [{ href: "/team", label: "Team" }, { href: "/audit", label: "Audit log" }] : []),
  ];
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="font-serif text-2xl leading-none"><span className="rounded-sm bg-brand/25 px-1">Source</span>mark</Link>
          <nav className="order-last flex w-full gap-4 overflow-x-auto text-sm sm:order-none sm:w-auto">
            {nav.map((n) => (
              <Link key={n.href} href={n.href}
                className={(n.href === "/" ? path === "/" : path.startsWith(n.href)) ? "font-medium text-ink" : "text-slate-500 hover:text-ink"}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {me.memberships.length > 1 && (
              <select className="input w-auto" value={orgId ?? ""} onChange={(e) => setOrgId(e.target.value)} aria-label="Organisation">
                {me.memberships.map((m) => <option key={m.org.id} value={m.org.id}>{m.org.name}</option>)}
              </select>
            )}
            <span className="hidden text-slate-500 md:inline">{me.user.email}</span>
            <ThemeToggle />
            <button className="btn-secondary" onClick={() => void signOut()}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {orgId ? children : <Loading />}
      </main>
    </div>
  );
}
