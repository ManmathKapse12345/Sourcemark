import Link from "next/link";
import { InkShader } from "@/components/landing/InkShader";
import { ThemeToggle } from "@/components/ThemeToggle";
import { HeroScan } from "@/components/landing/HeroScan";
import { TryIt } from "@/components/landing/TryIt";
import { CountUp } from "@/components/landing/CountUp";
import { SectionNav } from "@/components/landing/SectionNav";

const d = (s: number) => ({ "--d": `${s}s` }) as React.CSSProperties;
const DEMO_LOGIN = process.env.NEXT_PUBLIC_DEMO_LOGIN === "true";

const STEPS = [
  { t: "Rules run first", p: "Prices, product names, banned words and capitals are checked by plain code. No AI guessing on anything a rule can decide." },
  { t: "Only the right guidelines", p: "For each passage, Sourcemark pulls just the few guideline clauses that matter and hands them to the AI, each with its ID." },
  { t: "Answers must cite", p: "The AI has to reply in a fixed format where every problem names the clause it breaks and quotes it." },
  { t: "Citation check", p: "Our code looks the quote up in your brand kit. If it is not there, the finding is downgraded to “please confirm”. Never reported as an error." },
];

const CHECKS = ["Prices against the fact sheet", "Product names", "Banned and hype words", "Medical claims", "#ad disclosures", "Words in capitals", "Overlong sentences", "Rankings without a source", "Tone, checked by AI with citations"];

const STATES = ["Draft", "Checking", "In review", "Approved"];

const ROLES = [
  { r: "Creator", d: "Gets clear reasons and ready fixes before anyone else sees the draft." },
  { r: "Reviewer", d: "Sees only what needs judgement, with the creator’s answers next to each issue." },
  { r: "Approver", d: "Signs off with proof that every fact matches an approved source." },
  { r: "Brand admin", d: "Uploads the guidelines once. Sees which rules keep confusing people." },
];

export default function Welcome() {
  return (
    <div id="top" className="grain relative overflow-x-clip">
      <SectionNav />
      {/* ---------- HERO: framed artwork, like a gallery print ---------- */}
      <section className="px-2.5 pt-2.5 sm:px-4 sm:pt-4">
        <div className="relative isolate flex min-h-[calc(100svh-1.25rem)] flex-col overflow-hidden rounded-[1.75rem] border border-slate-200 sm:min-h-[calc(100svh-2rem)] sm:rounded-[2.25rem]">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(80%_70%_at_70%_30%,var(--glow-a),transparent),radial-gradient(60%_60%_at_20%_80%,var(--glow-c),transparent),var(--c-slate-50)]">
            <InkShader />
          </div>
          <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(100deg,color-mix(in_srgb,var(--c-slate-50)_72%,transparent)_0%,color-mix(in_srgb,var(--c-slate-50)_30%,transparent)_45%,transparent_70%)]" />

          <nav className="relative z-10 mx-auto flex w-full max-w-7xl items-center gap-8 px-5 py-5 sm:px-8">
            <Link href="/welcome" className="font-serif text-2xl"><span className="rounded-sm bg-brand/25 px-1">Source</span>mark</Link>
            <div className="hidden gap-7 text-sm text-slate-700 md:flex">
              <a href="#try" className="hover:text-ink">Try it</a><a href="#how" className="hover:text-ink">How it works</a><a href="#flow" className="hover:text-ink">Workflow</a>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle />
              {DEMO_LOGIN && <Link href="/login#demo" className="btn-primary !rounded-full !px-5">Demo login</Link>}
              <Link href="/login" className="btn-secondary !rounded-full !px-5">Sign in</Link>
            </div>
          </nav>

          <div className="relative z-10 mx-auto grid w-full max-w-7xl flex-1 items-center gap-12 px-5 pb-10 pt-6 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:pb-16">
            <div>
              <p className="rise mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/60 px-3 py-1 text-xs text-slate-700 backdrop-blur" style={d(0.1)}>
                <span className="size-1.5 rounded-full bg-brand" /> Pre-publication review for brand teams
              </p>
              <h1 className="rise !text-[clamp(3.1rem,7.4vw,7rem)] !leading-[0.92] !tracking-[-0.03em]" style={d(0.2)}>
                Catch it <em className="gold-text">before</em><br />the world does.
              </h1>
              <p className="rise mt-7 max-w-xl text-lg leading-relaxed text-slate-700" style={d(0.4)}>
                Sourcemark reads every post, email and document against your own guidelines and price sheet. Each problem points to the exact rule behind it. If there is no source, it is never called an error.
              </p>
              <div className="rise mt-9 flex flex-wrap gap-3" style={d(0.55)}>
                <a href="#try" className="btn-primary !rounded-full !px-6 !py-3 !text-base">Try it on a caption</a>
                <Link href="/login" className="btn-secondary !rounded-full !px-6 !py-3 !text-base">Open the workspace</Link>
              </div>
            </div>
            <div className="rise" style={d(0.35)}><HeroScan /></div>
          </div>

          <div className="relative z-10 overflow-hidden border-t border-slate-200 bg-white/40 py-3 backdrop-blur-md">
            <div className="marquee flex w-max gap-10 whitespace-nowrap text-sm text-slate-700">
              {[0, 1].map((k) => (
                <div key={k} className="flex gap-10" aria-hidden={k === 1}>
                  {CHECKS.map((c) => <span key={c} className="flex items-center gap-10">{c}<span className="text-brand">✦</span></span>)}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------- EVIDENCE ---------- */}
      <section className="relative border-y border-slate-200 bg-slate-100/40">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-20 md:grid-cols-3">
          {[
            { n: 98, s: "%", l: "of 6,117 ads scrutinised by ASCI in Apr–Sep 2025 needed changes.", src: "ASCI half-yearly report 2025–26" },
            { n: 23.22, dec: 2, s: "%", l: "of those ads misled consumers with dishonest claims.", src: "ASCI half-yearly report 2025–26" },
            { n: 81, s: "%", l: "of 200+ organisations say they run into off-brand content.", src: "Lucidpress study, 2019" },
          ].map((x) => (
            <div key={x.l} className="space-y-3">
              <p className="font-serif text-7xl gold-text"><CountUp to={x.n} decimals={x.dec} suffix={x.s} /></p>
              <p className="max-w-xs text-lg text-slate-700">{x.l}</p>
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{x.src}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- TRY IT ---------- */}
      <section id="try" className="mx-auto max-w-7xl px-6 py-28">
        <div className="mb-12 max-w-2xl">
          <p className="mb-3 text-xs uppercase tracking-[0.18em] text-brand">Live demo · runs in your browser</p>
          <h2 className="display text-5xl leading-tight md:text-6xl">Edit the caption. Watch it get checked.</h2>
          <p className="mt-4 text-lg text-slate-600">It checks against the brand kit of Northfern Skincare, our sample workspace: its price sheet, product names and style rules. Type anything, then hover a highlight to see the rule it comes from.</p>
        </div>
        <TryIt />
      </section>

      {/* ---------- HOW ---------- */}
      <section id="how" className="relative overflow-hidden py-28">
        <div className="aurora !top-20 !h-[60vh] !opacity-30" aria-hidden><span className="left-[30%] top-0 size-[40rem] bg-[var(--glow-a)]/60" /></div>
        <div className="relative mx-auto max-w-7xl px-6">
          <div className="mb-14 grid gap-6 md:grid-cols-2 md:items-end">
            <h2 className="display text-5xl leading-tight md:text-6xl">AI that has to <em className="gold-text">show its sources.</em></h2>
            <p className="text-lg text-slate-600">People abandon review tools that make things up. So every finding passes four gates before anyone sees it.</p>
          </div>
          <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.t} className="glass group relative rounded-2xl p-6 transition hover:-translate-y-1">
                <span className="font-serif text-6xl text-slate-200 transition group-hover:text-brand/60">{i + 1}</span>
                <h3 className="mt-2 text-lg font-medium">{s.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.p}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------- WORKFLOW ---------- */}
      <section id="flow" className="mx-auto max-w-7xl px-6 py-28">
        <h2 className="display max-w-3xl text-5xl leading-tight md:text-6xl">The AI explains. It never approves.</h2>
        <p className="mt-4 max-w-2xl text-lg text-slate-600">Content moves through fixed steps. A creator can submit but never approve their own work, and every decision is recorded with who and when.</p>
        <div className="glass mt-12 rounded-3xl p-6 md:p-10">
          <ol className="grid gap-6 md:grid-cols-4">
            {STATES.map((s, i) => (
              <li key={s} className="relative">
                {i < STATES.length - 1 && <span aria-hidden className="absolute left-12 right-0 top-5 hidden h-px bg-gradient-to-r from-brand/60 to-slate-200 md:block" />}
                <span className={`relative grid size-10 place-items-center rounded-full text-sm font-semibold ${i === 3 ? "bg-green-800 text-slate-50 shadow-[0_0_24px_rgba(126,226,161,.5)]" : "bg-brand text-slate-50"}`}>{i === 3 ? "✓" : i + 1}</span>
                <p className="mt-4 text-lg font-medium">{s}</p>
                <p className="text-sm text-slate-500">{["Creator writes or uploads", "Rules + AI, every finding cited", "A person accepts, edits or sends back", "Ready to publish, full history"][i]}</p>
              </li>
            ))}
          </ol>
          <div className="mt-10 grid gap-3 border-t border-slate-200 pt-8 sm:grid-cols-2 lg:grid-cols-4">
            {ROLES.map((r) => (
              <div key={r.r} className="rounded-xl bg-slate-100/60 p-4">
                <p className="font-medium text-brand">{r.r}</p>
                <p className="mt-1 text-sm text-slate-600">{r.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section className="relative overflow-hidden border-t border-slate-200">
        <div className="aurora !h-[70vh] !opacity-40" aria-hidden><span className="left-[35%] top-[30%] size-[34rem] bg-[var(--glow-b)]/40" /></div>
        <div className="relative mx-auto max-w-4xl px-6 py-32 text-center">
          <h2 className="display text-6xl leading-[1.02] md:text-8xl">Publish with <em className="gold-text">proof.</em></h2>
          <p className="mx-auto mt-6 max-w-xl text-lg text-slate-600">Set up your brand kit once. Every draft after that is checked in seconds, and every decision stays on record.</p>
          <div className="mt-10 flex justify-center gap-3">
            <Link href="/login" className="btn-primary !rounded-full !px-7 !py-3 !text-base">Open the workspace</Link>
            <a href="#try" className="btn-secondary !rounded-full !px-7 !py-3 !text-base">Try the demo</a>
          </div>
        </div>
        <footer className="relative mx-auto flex max-w-7xl flex-wrap gap-4 px-6 pb-10 text-xs text-slate-500">
          <span className="font-serif text-base text-slate-600">Sourcemark</span>
          <span>Built by team MANMATHKAPSE9 for the Inkloom AI brand governance challenge.</span>
          <span className="ml-auto">Northfern Skincare is a sample workspace for trying Sourcemark.</span>
        </footer>
      </section>
    </div>
  );
}
