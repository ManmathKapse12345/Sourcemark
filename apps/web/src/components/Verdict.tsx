import type { ContentDetail } from "@/lib/types";
import { Stepper } from "./Stepper";

/** The one-glance answer: can this be published? */
export function Verdict({ d }: { d: ContentDetail }) {
  const findings = d.latestRun?.findings ?? [];
  const open = findings.filter((f) => f.status === "OPEN" || f.status === "DISPUTED");
  const problems = open.filter((f) => f.kind === "violation").length;
  const checks = open.filter((f) => f.kind === "needs_human_check").length;
  const total = problems + checks + d.closedFindingCount;
  const solved = total === 0 ? 1 : d.closedFindingCount / total;
  const state = d.item.state;

  const broken = d.latestRun?.status === "FAILED";
  const disputes = open.filter((f) => f.responses.at(-1)?.action === "DISPUTE").length;
  const tone =
    state === "APPROVED" ? { c: "green", h: "Approved. Safe to publish.", p: "A person signed this off and every issue was resolved." }
    : state === "REJECTED" ? { c: "red", h: "Rejected. Do not publish.", p: "An approver decided this content should not go out." }
    : broken ? { c: "amber", h: "The check didn’t finish", p: "Results below may be incomplete. Re-check before sending it on." }
    : problems > 0 ? { c: "red", h: "Not ready to publish yet", p: `${problems} ${problems === 1 ? "problem breaks" : "problems break"} your guidelines or facts. Fix them, then send it on.` }
    : checks > 0 ? { c: "amber", h: "Almost there", p: `${checks} ${checks === 1 ? "item needs" : "items need"} a person to confirm before this goes out.` }
    : { c: "green", h: "No issues found", p: "Every check passed against your approved guidelines." };

  const ring = { green: "var(--color-green-800)", amber: "var(--color-brand)", red: "var(--color-red-700)" }[tone.c]!;
  const R = 30, C = 2 * Math.PI * R;
  return (
    <section className="card space-y-5 !p-5">
      <div className="flex flex-wrap items-center gap-5">
        <svg width="76" height="76" viewBox="0 0 76 76" role="img" aria-label={`${Math.round(solved * 100)}% of issues resolved`}>
          <circle cx="38" cy="38" r={R} fill="none" stroke="var(--color-slate-200)" strokeWidth="7" />
          <circle cx="38" cy="38" r={R} fill="none" stroke={ring} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - solved)} transform="rotate(-90 38 38)" />
          <text x="38" y="43" textAnchor="middle" fontSize="16" fontWeight="600" fill="currentColor">{Math.round(solved * 100)}%</text>
        </svg>
        <div className="min-w-0 flex-1">
          <h2 className="display text-2xl">{tone.h}</h2>
          <p className="text-sm text-slate-600">{tone.p}</p>
          {disputes > 0 && <p className="mt-1 text-sm text-amber-800">{disputes} {disputes === 1 ? "finding is" : "findings are"} disputed by the writer.</p>}
        </div>
        <dl className="flex gap-3 text-center">
          {[["Problems", problems, "text-red-700"], ["To confirm", checks, "text-amber-800"], ["Fixed", d.closedFindingCount, "text-green-800"]].map(([l, n, c]) => (
            <div key={l as string} className="min-w-16 rounded-lg bg-slate-100 px-3 py-2">
              <dd className={`text-2xl font-semibold tabular-nums ${c}`}>{n}</dd>
              <dt className="text-xs text-slate-500">{l}</dt>
            </div>
          ))}
        </dl>
      </div>
      <Stepper state={state} />
    </section>
  );
}
