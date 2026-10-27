"use client";
import { useEffect, useState } from "react";

const STEPS = ["Reading the text", "Checking brand rules", "Comparing prices and facts", "Asking the AI for judgement calls", "Checking every citation"];

/** Shown while a check runs (10–30 s). Steps advance on a timer; they describe what the server does, in order. */
export function CheckingPanel() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => Math.min(v + 1, STEPS.length - 1)), 3500);
    return () => clearInterval(t);
  }, []);
  return (
    <div role="status" aria-live="polite" className="card space-y-4 !border-brand/50 !p-6">
      <div className="flex items-center gap-3">
        <span className="size-3 animate-ping rounded-full bg-brand" />
        <h2 className="display text-2xl">Checking against your guidelines…</h2>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-brand transition-all duration-[3500ms] ease-out" style={{ width: `${((i + 1) / STEPS.length) * 92}%` }} />
      </div>
      <ol className="grid gap-1.5 text-sm sm:grid-cols-2">
        {STEPS.map((s, k) => (
          <li key={s} className={k < i ? "text-green-800" : k === i ? "font-medium" : "text-slate-500"}>{k < i ? "✓" : k === i ? "•" : "○"} {s}</li>
        ))}
      </ol>
      <p className="text-xs text-slate-500">This usually takes 10 to 30 seconds. You can stay on this page.</p>
    </div>
  );
}
