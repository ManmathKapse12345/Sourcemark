/** The hero's one orchestrated moment: a caption gets scanned, three words are marked, and each one is footnoted with its source. */
const NOTES = [
  { n: 1, tone: "red", code: "R-1", label: "Problem", text: "“Miracle” is on your banned hype-words list.", fix: "→ gentle" },
  { n: 2, tone: "red", code: "F-2", label: "Problem", text: "Approved price is ₹549 since 1 July 2026.", fix: "→ ₹549" },
  { n: 3, tone: "gold", code: "G-3.2", label: "Please confirm", text: "Rankings need a cited source. A person decides.", fix: "" },
];

export function HeroScan() {
  const sup = (n: number) => <sup className="ml-0.5 font-mono text-[0.55em] text-brand">{n}</sup>;
  return (
    <div className="glass relative rotate-[-1.2deg] overflow-hidden rounded-2xl p-6 sm:p-8">
      <div className="mb-5 flex items-center gap-2 text-xs text-slate-500">
        <span className="size-2 animate-pulse rounded-full bg-brand" /> Checking · instagram caption · v1
        <span className="ml-auto font-mono">1.8 s</span>
      </div>
      <div className="relative">
        <p className="font-serif text-[1.65rem] leading-[1.45] sm:text-[2rem]">
          Our Calm Barrier Moisturiser is a <span className="hl hl-red" style={{ "--d": ".9s" } as React.CSSProperties}>miracle</span>{sup(1)} for dry skin, now just{" "}
          <span className="hl hl-red" style={{ "--d": "1.6s" } as React.CSSProperties}>₹499</span>{sup(2)}. Rated the{" "}
          <span className="hl hl-gold" style={{ "--d": "2.3s" } as React.CSSProperties}>#1 moisturiser</span>{sup(3)} in India.
        </p>
        <span className="scanline" />
      </div>
      <ol className="mt-6 space-y-2 border-t border-slate-200 pt-4">
        {NOTES.map((x, i) => (
          <li key={x.n} className="rise flex items-start gap-3 text-sm" style={{ "--d": `${2.9 + i * .25}s` } as React.CSSProperties}>
            <span className="mt-0.5 font-mono text-xs text-brand">{x.n}</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${x.tone === "red" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>{x.label}</span>
            <span className="min-w-0 flex-1 text-slate-700">{x.text} <span className="font-mono text-xs text-slate-500">{x.code}</span></span>
            {x.fix && <span className="shrink-0 rounded bg-green-100 px-1.5 text-xs text-green-800">{x.fix}</span>}
          </li>
        ))}
      </ol>
      <div className="rise mt-5 flex items-center gap-3 rounded-xl bg-slate-100/60 px-4 py-3 text-sm" style={{ "--d": "3.8s" } as React.CSSProperties}>
        <span className="size-2.5 rounded-full bg-red-600 shadow-[0_0_12px_2px_rgba(214,69,77,.6)]" />
        <span className="font-medium">Not ready to publish</span>
        <span className="ml-auto text-xs text-slate-500">2 problems · 1 to confirm · 0 invented</span>
      </div>
    </div>
  );
}
