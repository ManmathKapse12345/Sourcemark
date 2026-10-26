"use client";
import { useState } from "react";

/** Password field with show/hide, and an optional strength meter for new passwords. */
export function PasswordInput({ id, value, onChange, autoComplete, meter = false }: {
  id: string; value: string; onChange: (v: string) => void; autoComplete: string; meter?: boolean;
}) {
  const [show, setShow] = useState(false);
  const score = [value.length >= 8, /[A-Z]/.test(value) && /[a-z]/.test(value), /\d/.test(value), /[^A-Za-z0-9]/.test(value) || value.length >= 14].filter(Boolean).length;
  const label = ["Too short", "Weak", "Fair", "Good", "Strong"][value.length < 8 ? 0 : score];
  const color = ["bg-red-600", "bg-red-600", "bg-amber-300", "bg-green-800", "bg-green-800"][value.length < 8 ? 0 : score];
  return (
    <div className="space-y-2">
      <div className="relative">
        <input id={id} type={show ? "text" : "password"} className="input !pr-16" value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required minLength={meter ? 8 : undefined} />
        <button type="button" onClick={() => setShow(!show)} className="absolute inset-y-0 right-2 my-auto h-7 rounded-md px-2 text-xs text-slate-600 hover:text-ink" aria-pressed={show}>{show ? "Hide" : "Show"}</button>
      </div>
      {meter && value && (
        <div className="flex items-center gap-3" aria-live="polite">
          <div className="flex flex-1 gap-1">{[0, 1, 2, 3].map((i) => <span key={i} className={`h-1 flex-1 rounded-full transition-colors ${i < (value.length < 8 ? 1 : score) ? color : "bg-slate-200"}`} />)}</div>
          <span className="w-16 text-right text-xs text-slate-500">{label}</span>
        </div>
      )}
    </div>
  );
}
