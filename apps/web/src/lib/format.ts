export const stateLabel: Record<string, string> = {
  DRAFT: "Draft", CHECKING: "Checking", IN_REVIEW: "In review",
  CHANGES_REQUESTED: "Changes requested", APPROVED: "Approved", REJECTED: "Rejected",
};
export const stateColor: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700", CHECKING: "bg-amber-100 text-amber-800",
  IN_REVIEW: "bg-blue-100 text-blue-800", CHANGES_REQUESTED: "bg-orange-100 text-orange-800",
  APPROVED: "bg-green-100 text-green-800", REJECTED: "bg-red-100 text-red-800",
};
export const severityColor: Record<string, string> = {
  high: "bg-red-100 text-red-800", medium: "bg-amber-100 text-amber-800", low: "bg-slate-100 text-slate-700",
};
export const fmtDate = (s: string) => new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
