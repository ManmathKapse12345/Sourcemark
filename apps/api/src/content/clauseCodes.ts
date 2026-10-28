// Rules and findings cite clauses by code, so a code must keep its meaning across guideline versions.
// The extractor numbers clauses by position; these helpers carry codes over by text instead.

export interface CodedClause {
  code: string;
  text: string;
}

const words = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
const normal = (t: string) => words(t).join(" ");

// Dice coefficient over distinct words: 1 for the same words, 0 for none in common.
function similarity(a: string, b: string) {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return (2 * shared) / (x.size + y.size);
}

const MIN_SIMILARITY = 0.6;

// Next code after `code` that is not taken: G2-1.3 -> G2-1.4, G-7 -> G-8.
export function nextFreeCode(code: string, taken: Set<string>) {
  const m = /^(.*?)(\d+)$/.exec(code);
  const stem = m ? m[1]! : `${code}.`;
  let n = m ? Number(m[2]) : 0;
  let next: string;
  do next = `${stem}${++n}`; while (taken.has(next));
  return next;
}

/**
 * Gives each new clause the code of the previous-version clause it continues (same text, or edited
 * but mostly the same words). Other clauses keep their extracted code unless the guideline has
 * used it before, in which case they get a fresh one, so a removed clause's code is never reused.
 */
export function carryOverCodes<T extends CodedClause>(next: T[], previous: CodedClause[], everUsed: Iterable<string>): T[] {
  const codes: (string | undefined)[] = next.map(() => undefined);
  const free = new Set(previous.map((_, j) => j));

  next.forEach((c, i) => {
    const j = [...free].find((k) => normal(previous[k]!.text) === normal(c.text));
    if (j !== undefined) { codes[i] = previous[j]!.code; free.delete(j); }
  });

  const pairs: { i: number; j: number; score: number }[] = [];
  next.forEach((c, i) => {
    if (codes[i]) return;
    for (const j of free) {
      const score = similarity(c.text, previous[j]!.text);
      if (score >= MIN_SIMILARITY) pairs.push({ i, j, score });
    }
  });
  for (const p of pairs.sort((a, b) => b.score - a.score)) {
    if (codes[p.i] || !free.has(p.j)) continue;
    codes[p.i] = previous[p.j]!.code;
    free.delete(p.j);
  }

  const taken = new Set([...everUsed, ...codes.filter((c): c is string => !!c)]);
  return next.map((c, i) => {
    let code = codes[i];
    if (!code) {
      code = taken.has(c.code) ? nextFreeCode(c.code, taken) : c.code;
      taken.add(code);
    }
    return { ...c, code };
  });
}
