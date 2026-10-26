import type { Finding } from "@/lib/types";

const tone = (f: Finding) =>
  f.kind === "needs_human_check"
    ? "bg-amber-200 decoration-amber-800 underline decoration-dotted decoration-2 underline-offset-4"
    : "bg-red-200 decoration-red-700 underline decoration-wavy underline-offset-4";

/** Renders the body with each finding's [spanStart, spanEnd) range marked. Overlaps: first span wins. */
export function HighlightedBody({ body, findings, activeId, onSelect }: {
  body: string; findings: Finding[]; activeId: string | null; onSelect: (id: string) => void;
}) {
  const spans = findings
    .filter((f) => f.spanStart != null && f.spanEnd != null && f.status !== "CLOSED" && f.status !== "SUPERSEDED")
    .sort((a, b) => a.spanStart! - b.spanStart!);
  const out: React.ReactNode[] = [];
  let pos = 0;
  for (const f of spans) {
    if (f.spanStart! < pos || f.spanEnd! > body.length) continue;
    if (f.spanStart! > pos) out.push(body.slice(pos, f.spanStart!));
    out.push(
      <mark key={f.id} onClick={() => onSelect(f.id)}
        className={`cursor-pointer rounded px-1 py-0.5 text-ink transition hover:brightness-125 ${tone(f)} ${activeId === f.id ? "ring-2 ring-brand" : ""}`}>
        {body.slice(f.spanStart!, f.spanEnd!)}
      </mark>,
    );
    pos = f.spanEnd!;
  }
  out.push(body.slice(pos));
  return <p className="whitespace-pre-wrap text-[17px] leading-8">{out}</p>;
}
