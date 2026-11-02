import { conflict } from "../http/errors.js";

export interface Edit {
  start: number;
  end: number;
  replacement: string;
  label: string; // shown in the error when two edits overlap
  chosenAt?: Date; // when the writer picked it; set for fixes chosen on findings
}

// A writer who picks one fix and then another for the same words has changed their mind: the
// later choice replaces the earlier one. Edits without `chosenAt` (rewrites picked when applying)
// are left alone, so a clash with them is still reported.
export function latestChoiceWins(edits: Edit[]): Edit[] {
  return edits.filter(
    (e) =>
      !e.chosenAt ||
      !edits.some(
        (o) => o !== e && o.chosenAt && o.chosenAt > e.chosenAt! && rangesClash(e, o) &&
          !(o.start === e.start && o.end === e.end && o.replacement === e.replacement),
      ),
  );
}

function rangesClash(a: Edit, b: Edit): boolean {
  return (a.start < b.end && b.start < a.end) || (a.start === a.end && b.start === b.end && a.start === b.start);
}

// Applies non-overlapping replacements to a text. Edits are applied from the end so
// earlier offsets stay valid. Two edits on overlapping ranges are a conflict the creator
// has to settle (for example by choosing the sentence rewrite or the single fix).
export function applyEdits(text: string, edits: Edit[]): string {
  // The same change suggested by two findings (same range, same text) is applied once.
  const unique = edits.filter(
    (e, i) => edits.findIndex((o) => o.start === e.start && o.end === e.end && o.replacement === e.replacement) === i,
  );
  const sorted = [...unique].sort((a, b) => a.start - b.start || a.end - b.end);
  for (const e of sorted) {
    if (e.start < 0 || e.end > text.length || e.start > e.end) {
      throw conflict(`${e.label} no longer fits this version of the text`);
    }
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    // Two insertions at the same point, or ranges that intersect, cannot both apply.
    if (cur.start < prev.end || (cur.start === prev.start && cur.start === cur.end && prev.start === prev.end)) {
      throw conflict(`${prev.label} and ${cur.label} change the same text; apply one of them`);
    }
  }
  let out = text;
  for (const e of sorted.reverse()) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  }
  return out;
}
