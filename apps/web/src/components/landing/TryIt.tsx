"use client";
import { useMemo, useState } from "react";

/* A small in-browser copy of the Northfern Skincare sample brand kit (Calm Barrier products, from the Round 1 plan).
   The real product runs these checks on the server, plus AI judgement with a citation check. */
type Check = { re: RegExp; kind: "problem" | "confirm"; code: string; cat: string; source: string; why: string; fix?: (m: string) => string };
const KIT: Check[] = [
  { re: /\bCalm Barrier Cream\b/g, kind: "problem", code: "R-2", cat: "Product name", source: "Glossary: always “Calm Barrier Moisturiser”.", why: "Wrong product name", fix: () => "Calm Barrier Moisturiser" },
  { re: /₹\s?499\b/g, kind: "problem", code: "F-2", cat: "Price", source: "Fact sheet: Calm Barrier Moisturiser, 50 g, ₹549 since 1 July 2026.", why: "₹499 was the old price, valid until 30 June", fix: () => "₹549" },
  { re: /\b(miracle|magic|guaranteed)\b/gi, kind: "problem", code: "R-1", cat: "Hype word", source: "Guideline 2.1: no hype words such as miracle, magic, guaranteed.", why: "Banned hype word", fix: () => "gentle" },
  { re: /\b(cures?|heals?|treats?)\b/gi, kind: "problem", code: "G-2.3", cat: "Medical claim", source: "Guideline 2.3: cosmetics may not claim to cure or treat.", why: "Medical claim", fix: (m) => (/^c/i.test(m) ? "soothes" : "comforts") },
  { re: /!{2,}/g, kind: "problem", code: "R-4", cat: "Punctuation", source: "Style rule: at most one exclamation mark.", why: "Too many exclamation marks", fix: () => "!" },
  { re: /\b(?!INR\b)[A-Z]{4,}\b/g, kind: "problem", code: "R-3", cat: "Capitals", source: "Style rule: no words in all capitals.", why: "Shouting in capitals", fix: (m) => m.toLowerCase() },
  { re: /(#1|\bnumber one\b|\bbest\b)(\s+[\w-]+){0,2}/gi, kind: "confirm", code: "G-3.2", cat: "Ranking claim", source: "Guideline 3.2: rankings need a cited source.", why: "No approved source for this ranking. A person should confirm it." },
];

const SAMPLE = "Our Calm Barrier Cream is a MIRACLE for dry skin, now just ₹499!! Rated the best moisturiser in India and it cures redness overnight.";

type Hit = Check & { start: number; end: number; text: string; id: number };
function run(text: string): Hit[] {
  const hits: Hit[] = [];
  KIT.forEach((c) => { for (const m of text.matchAll(c.re)) hits.push({ ...c, start: m.index!, end: m.index! + m[0].length, text: m[0], id: hits.length }); });
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  // Same words flagged twice (e.g. MIRACLE: capitals + hype word) become one finding, as in the real merge step.
  return hits.filter((h, i) => !hits.slice(0, i).some((p) => p.start <= h.start && p.end >= h.end && p.kind === h.kind));
}

export function TryIt() {
  const [text, setText] = useState(SAMPLE);
  const [active, setActive] = useState<number | null>(null);
  const hits = useMemo(() => run(text), [text]);
  const problems = hits.filter((h) => h.kind === "problem");
  const confirms = hits.filter((h) => h.kind === "confirm");

  const applyAll = () => {
    let out = text;
    [...problems].filter((h) => h.fix).sort((a, b) => b.start - a.start).forEach((h) => { out = out.slice(0, h.start) + h.fix!(h.text) + out.slice(h.end); });
    setText(out);
  };

  const parts: React.ReactNode[] = []; let pos = 0;
  hits.forEach((h, i) => {
    if (h.start < pos) return;
    parts.push(text.slice(pos, h.start));
    parts.push(
      <mark key={i} onMouseEnter={() => setActive(h.id)} onMouseLeave={() => setActive(null)}
        className={`rounded px-0.5 text-ink transition ${h.kind === "problem" ? "bg-red-200 underline decoration-wavy decoration-red-700 underline-offset-4" : "bg-amber-200 underline decoration-dotted decoration-2 decoration-amber-800 underline-offset-4"} ${active === h.id ? "ring-2 ring-brand" : ""}`}>
        {text.slice(h.start, h.end)}
      </mark>,
    );
    pos = h.end;
  });
  parts.push(text.slice(pos));

  const verdict = problems.length ? ["Not ready to publish", "bg-red-600", "rgba(214,69,77,.6)"] : confirms.length ? ["Almost there: a person should confirm", "bg-brand", "rgba(245,196,81,.6)"] : ["Ready for a reviewer", "bg-green-800", "rgba(126,226,161,.6)"];

  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
      <div className="glass space-y-4 rounded-2xl p-5">
        <label htmlFor="try" className="flex items-center justify-between text-xs uppercase tracking-[0.14em] text-slate-500">
          Your draft <button type="button" className="normal-case tracking-normal text-brand hover:underline" onClick={() => setText(SAMPLE)}>Reset example</button>
        </label>
        <textarea id="try" value={text} onChange={(e) => setText(e.target.value)} rows={3}
          className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-ink focus:border-brand focus:outline-none" />
        <p className="text-xs uppercase tracking-[0.14em] text-slate-500">What Sourcemark sees</p>
        <p className="min-h-24 text-xl leading-9">{parts}</p>
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-100/60 px-4 py-3">
          <span className={`size-2.5 rounded-full ${verdict[1]}`} style={{ boxShadow: `0 0 12px 2px ${verdict[2]}` }} />
          <span className="font-medium">{verdict[0]}</span>
          {problems.some((p) => p.fix) && <button className="btn-primary ml-auto" onClick={applyAll}>Apply all fixes</button>}
        </div>
      </div>

      <ul className="space-y-2.5" aria-live="polite">
        {hits.length === 0 && <li className="glass rounded-2xl p-5 text-sm text-slate-600">Nothing breaks the brand kit. In the real app this now goes to a reviewer, because a person always makes the final call.</li>}
        {hits.map((h) => (
          <li key={`${h.code}-${h.start}`} onMouseEnter={() => setActive(h.id)} onMouseLeave={() => setActive(null)}
            className={`glass rounded-xl p-3.5 text-sm transition ${active === h.id ? "!border-brand/60 -translate-y-0.5" : ""}`}>
            <div className="mb-1 flex items-center gap-2">
              <span className={`size-2 rounded-full ${h.kind === "problem" ? "bg-red-600" : "bg-brand"}`} />
              <span className={`font-semibold ${h.kind === "problem" ? "text-red-700" : "text-amber-800"}`}>{h.kind === "problem" ? "Problem" : "Please confirm"}</span>
              <span className="text-slate-500">· {h.cat}</span>
              <span className="ml-auto font-mono text-xs text-brand">{h.code}</span>
            </div>
            <p className="text-slate-700">{h.why}{h.fix && <> · <span className="rounded bg-red-100 px-1 text-red-800 line-through">{h.text}</span> → <span className="rounded bg-green-100 px-1 text-green-800">{h.fix(h.text)}</span></>}</p>
            <p className="mt-1 text-xs text-slate-500">Source: {h.source}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
