"""Text utilities: sentence spans, normalisation and whole-word search with character offsets."""

from __future__ import annotations

import re
import unicodedata

ABBREVIATIONS = {
    "dr", "mr", "mrs", "ms", "prof", "rs", "st", "no", "vs", "etc", "e.g", "i.e", "inc", "ltd", "jr", "sr",
    "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "approx", "dept",
}

_CLOSERS = "\"')]”’"
_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", " ": " "})


def normalize(s: str) -> str:
    """Lower-case, unify quotes and dashes, collapse whitespace. Used for comparisons only."""
    s = unicodedata.normalize("NFKC", s).translate(_QUOTES).lower()
    return re.sub(r"\s+", " ", s).strip()


def _is_abbreviation(text: str, start: int, dot: int) -> bool:
    m = re.search(r"([\w.]+)$", text[start:dot])
    if not m:
        return False
    word = m.group(1).lower().rstrip(".")
    # Single letters are initials ("A. Rao"); otherwise check the known list.
    return len(word) == 1 and word.isalpha() or word in ABBREVIATIONS


def sentence_spans(text: str) -> list[tuple[int, int]]:
    """Splits text into sentences and lines, returning (start, end) offsets without surrounding space."""
    spans: list[tuple[int, int]] = []

    def add(a: int, b: int) -> None:
        while a < b and text[a].isspace():
            a += 1
        while b > a and text[b - 1].isspace():
            b -= 1
        if b > a:
            spans.append((a, b))

    start, i, n = 0, 0, len(text)
    while i < n:
        ch = text[i]
        if ch == "\n":
            add(start, i)
            start = i + 1
            i += 1
            continue
        if ch in ".!?":
            j = i
            while j < n and text[j] in ".!?":
                j += 1
            while j < n and text[j] in _CLOSERS:
                j += 1
            if j == n or text[j].isspace():
                if ch == "." and j == i + 1 and _is_abbreviation(text, start, i):
                    i = j
                    continue
                add(start, j)
                start = j
            i = j
            continue
        i += 1
    add(start, n)
    return spans


def sentence_at(spans: list[tuple[int, int]], pos: int) -> tuple[int, int] | None:
    for a, b in spans:
        if a <= pos < b:
            return a, b
    return None


def term_pattern(term: str, case_sensitive: bool = False) -> re.Pattern[str]:
    """Whole-word pattern for a term; any run of whitespace in the term matches any whitespace."""
    parts = [re.escape(p) for p in term.split()]
    body = r"\s+".join(parts)
    flags = 0 if case_sensitive else re.IGNORECASE
    return re.compile(rf"(?<![\w#@]){body}(?!\w)", flags)


def find_term(text: str, term: str, case_sensitive: bool = False) -> list[tuple[int, int]]:
    return [(m.start(), m.end()) for m in term_pattern(term, case_sensitive).finditer(text)]


def overlaps(a: tuple[int, int], b: tuple[int, int]) -> bool:
    return a[0] < b[1] and b[0] < a[1]


def word_count(s: str) -> int:
    return len([w for w in s.split() if any(ch.isalnum() for ch in w)])


def locate(text: str, quote: str, start_at: int = 0) -> tuple[int, int] | None:
    """Finds a quote copied from text by a model: exact, then case-insensitive, then whitespace-tolerant."""
    q = quote.strip()
    if not q:
        return None
    pos = text.find(q, start_at)
    if pos >= 0:
        return pos, pos + len(q)
    lowered = text.lower().find(q.lower(), start_at)
    if lowered >= 0:
        return lowered, lowered + len(q)
    tokens = [re.escape(t) for t in q.translate(_QUOTES).split()]
    if not tokens:
        return None
    pattern = re.compile(r"\s+".join(tokens), re.IGNORECASE)
    m = pattern.search(text.translate(_QUOTES), start_at)
    return (m.start(), m.end()) if m else None
