export type DiffPart = { type: "same" | "add" | "del"; text: string };

/** Word-level diff (LCS over words and whitespace), good enough for captions and short documents. */
export function diffWords(a: string, b: string): DiffPart[] {
  const x = a.split(/(\s+)/), y = b.split(/(\s+)/);
  const n = x.length, m = y.length;
  if (n * m > 4_000_000) return [{ type: "del", text: a }, { type: "add", text: b }];
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (type: DiffPart["type"], text: string) => {
    const last = out.at(-1);
    if (last?.type === type) last.text += text; else out.push({ type, text });
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { push("same", x[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) push("del", x[i++]);
    else push("add", y[j++]);
  }
  while (i < n) push("del", x[i++]);
  while (j < m) push("add", y[j++]);
  return out;
}

/** The sentence around [start, end) in text, with the span replaced by `replacement`. */
export function sentencePreview(text: string, start: number, end: number, replacement: string) {
  const before = text.slice(0, start), after = text.slice(end);
  const s = Math.max(before.search(/[^.!?\n]*$/), 0);
  const eRel = after.search(/[.!?\n]/);
  const e = eRel === -1 ? after.length : eRel + 1;
  return { before: before.slice(s), replacement, after: after.slice(0, e) };
}
