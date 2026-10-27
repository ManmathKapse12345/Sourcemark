import { severityColor, stateColor, stateLabel } from "@/lib/format";

export const Badge = ({ className = "", children }: { className?: string; children: React.ReactNode }) => (
  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>{children}</span>
);
export const StateBadge = ({ state }: { state: string }) => <Badge className={stateColor[state]}>{stateLabel[state] ?? state}</Badge>;
export const SeverityBadge = ({ s }: { s: string }) => <Badge className={severityColor[s]}>{s}</Badge>;

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{(error as Error).message}</p>;
}
export const Loading = () => <p className="text-sm text-slate-500">Loading…</p>;
export const Empty = ({ children }: { children: React.ReactNode }) => <p className="py-8 text-center text-sm text-slate-500">{children}</p>;
