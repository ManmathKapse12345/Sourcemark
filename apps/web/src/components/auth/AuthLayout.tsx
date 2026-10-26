import Link from "next/link";
import { InkShader } from "@/components/landing/InkShader";
import { ThemeToggle } from "@/components/ThemeToggle";

/** Split screen for every account page: artwork and a cited example on the left, the form on the right. */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative isolate m-2.5 hidden overflow-hidden rounded-[2rem] border border-slate-200 lg:flex lg:flex-col">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(80%_70%_at_70%_30%,var(--glow-a),transparent),var(--c-slate-50)]"><InkShader /></div>
        <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,transparent_40%,color-mix(in_srgb,var(--c-slate-50)_75%,transparent))]" />
        <Link href="/welcome" className="m-8 self-start font-serif text-2xl"><span className="rounded-sm bg-brand/25 px-1">Source</span>mark</Link>
        <div className="mt-auto space-y-6 p-10">
          <p className="max-w-md font-serif text-4xl leading-tight">“Every flag tells me <em className="gold-text">which rule</em> it came from. I stopped arguing and started fixing.”</p>
          <div className="glass max-w-md space-y-2 rounded-2xl p-4 text-sm">
            <p>Now just <span className="rounded bg-red-200 px-1 underline decoration-wavy decoration-red-700 underline-offset-4">₹499</span> for the 50 g jar.</p>
            <p className="text-xs text-slate-600"><span className="font-mono text-brand">F-2</span> Approved price is ₹549 since 1 July 2026 → <span className="rounded bg-green-100 px-1 text-green-800">₹549</span></p>
          </div>
        </div>
      </aside>
      <main className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center gap-4">
          <Link href="/welcome" className="font-serif text-2xl lg:hidden"><span className="rounded-sm bg-brand/25 px-1">Source</span>mark</Link>
          <Link href="/welcome" className="text-sm text-slate-500 hover:text-ink">← Back to overview</Link>
          <ThemeToggle className="ml-auto" />
        </div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">{children}</div>
        <p className="text-center text-xs text-slate-500">Your content stays inside your organisation. People make every final decision.</p>
      </main>
    </div>
  );
}

export function Field({ label, id, hint, children }: { label: string; id: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between"><label htmlFor={id} className="text-sm font-medium">{label}</label>{hint}</div>
      {children}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "ok" | "error"; children: React.ReactNode }) {
  const c = tone === "ok" ? "bg-green-100 text-green-800" : tone === "error" ? "bg-red-50 text-red-700" : "bg-brand-soft text-ink";
  return <p role={tone === "error" ? "alert" : "status"} className={`rounded-xl px-4 py-3 text-sm ${c}`}>{children}</p>;
}
