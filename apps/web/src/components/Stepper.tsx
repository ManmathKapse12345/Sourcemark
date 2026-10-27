const STEPS = [
  { key: "DRAFT", label: "Written", hint: "Creator drafts the content" },
  { key: "CHECKING", label: "Checked", hint: "Sourcemark compares it with your guidelines" },
  { key: "IN_REVIEW", label: "Reviewed", hint: "A person decides" },
  { key: "APPROVED", label: "Approved", hint: "Safe to publish" },
];

/** Where the content is on its way to publication, in plain words. */
export function Stepper({ state }: { state: string }) {
  const sideways = state === "CHANGES_REQUESTED" || state === "REJECTED";
  const at = state === "CHANGES_REQUESTED" ? 0 : state === "REJECTED" ? 2 : STEPS.findIndex((s) => s.key === state);
  return (
    <ol className="flex flex-wrap items-start gap-x-2 gap-y-3">
      {STEPS.map((s, i) => {
        const done = i < at || state === "APPROVED";
        const current = i === at && state !== "APPROVED";
        return (
          <li key={s.key} className="flex min-w-[7.5rem] flex-1 items-start gap-2">
            <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
              done ? "bg-green-100 text-green-800" : current ? (sideways ? "bg-red-100 text-red-800" : "bg-brand text-slate-50") : "bg-slate-100 text-slate-500"}`}>
              {done ? "✓" : i + 1}
            </span>
            <span className="text-sm leading-tight">
              <span className={current ? "font-semibold" : "text-slate-600"}>{s.label}</span>
              <span className="block text-xs text-slate-500">{current && sideways ? (state === "REJECTED" ? "Rejected" : "Needs changes") : s.hint}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
