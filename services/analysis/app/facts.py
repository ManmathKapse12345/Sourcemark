"""Checks figures, names and dates in a draft against the approved fact sheet.

Numbers are only compared with a fact when the fact's subject is mentioned in the same
sentence, and each number is assigned to the nearest mention. So "100,000 downloads" is never
compared with a fact about "10,000 users" of something else.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from difflib import SequenceMatcher

from .contract import FactDTO, FindingSource, Fix, RuleDTO
from .findings import Finding
from .text import find_term, normalize, overlaps

MONEY = re.compile(r"(?:₹|\bRs\.?|\bINR)\s?(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?", re.IGNORECASE)
UNITS = {
    "g": ["g", "gm", "gms", "gram", "grams"],
    "kg": ["kg", "kgs", "kilogram", "kilograms"],
    "ml": ["ml", "millilitre", "millilitres", "milliliter", "milliliters"],
    "l": ["l", "litre", "litres", "liter", "liters"],
    "%": ["%", "percent", "per cent"],
}
MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
               "October", "November", "December"]
_MONTH = r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
DATE_DMY = re.compile(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?{_MONTH}\.?,?(?:\s+(\d{{4}}))?\b", re.IGNORECASE)
DATE_MDY = re.compile(rf"\b{_MONTH}\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?,?(?:\s+(\d{{4}}))?\b", re.IGNORECASE)
DATE_NUM = re.compile(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b")
NOT_A_PRICE = re.compile(r"\b(above|over|under|below|up to|upto|save|saving|worth|spend|off|minimum|min\.?)\s*$", re.IGNORECASE)
HONORIFICS = re.compile(r"^(dr|mr|mrs|ms|prof)\.?\s+", re.IGNORECASE)


@dataclass
class Mention:
    start: int
    end: int
    subject: str  # normalised subject key


def _to_number(s: str) -> float:
    return float(s.replace(",", ""))


def _fmt_money(value: str) -> str:
    return f"₹{value}"


def is_current(f: FactDTO, as_of: date) -> bool:
    return date.fromisoformat(f.valid_from) <= as_of and (f.valid_until is None or date.fromisoformat(f.valid_until) >= as_of)


def display_value(f: FactDTO) -> str:
    if f.kind == "money":
        return _fmt_money(f.value)
    if f.kind == "quantity" and f.unit:
        return f"{f.value} {f.unit}"
    return f.value


def fact_text(f: FactDTO) -> str:
    """Citable text of a fact, as shown to the model and in findings."""
    period = f"since {f.valid_from}" if f.valid_until is None else f"{f.valid_from} to {f.valid_until}"
    return f"{f.subject}, {f.attribute}: {display_value(f)} ({period})"


def _fact_source(f: FactDTO) -> FindingSource:
    return FindingSource(type="fact", code=f.code, clause_code=None, text=fact_text(f))


def subject_names(facts: list[FactDTO], rules: list[RuleDTO]) -> dict[str, list[str]]:
    """Every way a subject may be written: its name, aliases, and known wrong variants from terminology rules,
    so "Calm Barrier Cream, now ₹499" is still checked against the moisturiser's price."""
    names: dict[str, set[str]] = {}
    for f in facts:
        key = normalize(f.subject)
        names.setdefault(key, set()).update([f.subject, *f.aliases])
    for r in rules:
        if r.type == "terminology" and normalize(r.config.get("preferred", "")) in names:
            names[normalize(r.config["preferred"])].update(r.config.get("variants", []))
    return {k: sorted(v, key=len, reverse=True) for k, v in names.items()}


def find_mentions(text: str, names: dict[str, list[str]]) -> list[Mention]:
    found: list[Mention] = []
    for key, variants in names.items():
        for v in variants:
            for s, e in find_term(text, v):
                if not any(overlaps((s, e), (m.start, m.end)) for m in found):
                    found.append(Mention(s, e, key))
    return sorted(found, key=lambda m: m.start)


def _nearest_subject(pos: int, sentence: tuple[int, int], mentions: list[Mention]) -> str | None:
    inside = [m for m in mentions if sentence[0] <= m.start < sentence[1]]
    if not inside:
        return None
    before = [m for m in inside if m.end <= pos]
    if before:
        return before[-1].subject
    return min(inside, key=lambda m: m.start - pos).subject


def _pick_fact(candidates: list[FactDTO], sentence_text: str) -> FactDTO | None:
    if len(candidates) == 1:
        return candidates[0]
    named = [f for f in candidates if normalize(f.attribute) in normalize(sentence_text)]
    return named[0] if len(named) == 1 else None


def _value_mismatch(text: str, kind: str, s: int, e: int, shown: str, current: FactDTO, history: list[FactDTO],
                    fix: str) -> Finding:
    old = next((h for h in history if h.kind == kind and _same_value(h, shown)), None)
    note = f" {shown} was the approved value until {old.valid_until}." if old and old.valid_until else ""
    return Finding(
        kind="violation",
        category="fact",
        severity="high",
        origins=["rule"],
        start=s,
        end=e,
        quote=text[s:e],
        explanation=f"The approved {current.attribute} of {current.subject} is {display_value(current)}, not {shown}.{note}",
        source=_fact_source(current),
        fix=Fix(start=s, end=e, replacement=fix),
    )


def _same_value(f: FactDTO, shown: str) -> bool:
    try:
        return _to_number(re.sub(r"[^\d.,]", "", shown)) == _to_number(f.value)
    except ValueError:
        return False


def check_numbers(text: str, sents: list[tuple[int, int]], facts: list[FactDTO], rules: list[RuleDTO],
                  as_of: date) -> list[Finding]:
    mentions = find_mentions(text, subject_names(facts, rules))
    by_subject: dict[str, list[FactDTO]] = {}
    for f in facts:
        by_subject.setdefault(normalize(f.subject), []).append(f)
    out: list[Finding] = []

    def candidates(subject: str, kind: str, unit: str | None = None) -> tuple[list[FactDTO], list[FactDTO]]:
        all_kind = [f for f in by_subject.get(subject, []) if f.kind == kind and (unit is None or _unit_key(f.unit) == unit)]
        return [f for f in all_kind if is_current(f, as_of)], [f for f in all_kind if not is_current(f, as_of)]

    for sentence in sents:
        stext = text[sentence[0]:sentence[1]]
        for m in MONEY.finditer(stext):
            s, e = sentence[0] + m.start(), sentence[0] + m.end()
            if NOT_A_PRICE.search(stext[:m.start()]):
                continue  # "orders above ₹999", "save ₹100": an amount, not this product's price
            subject = _nearest_subject(s, sentence, mentions)
            if not subject:
                continue
            current, history = candidates(subject, "money")
            fact = _pick_fact(current, stext)
            if fact and _to_number(m.group(1)) != _to_number(fact.value):
                out.append(_value_mismatch(text, "money", s, e, text[s:e], fact,
                                           [h for h in history if h.attribute == fact.attribute], _fmt_money(fact.value)))

        for unit_key, words in UNITS.items():
            pattern = re.compile(r"(\d+(?:\.\d+)?)\s?(?:" + "|".join(re.escape(w) for w in words) + r")(?![\w])", re.IGNORECASE)
            for m in pattern.finditer(stext):
                s, e = sentence[0] + m.start(), sentence[0] + m.end()
                subject = _nearest_subject(s, sentence, mentions)
                if not subject:
                    continue
                current, history = candidates(subject, "quantity", unit_key)
                fact = _pick_fact(current, stext)
                if fact and float(m.group(1)) != _to_number(fact.value):
                    out.append(_value_mismatch(text, "quantity", s, e, text[s:e], fact, history,
                                               f"{fact.value} {fact.unit}" if " " in m.group(0) else f"{fact.value}{fact.unit}"))
    return out


def _unit_key(unit: str | None) -> str | None:
    if unit is None:
        return None
    u = unit.lower()
    return next((k for k, words in UNITS.items() if u == k or u in words), u)


def check_names(text: str, facts: list[FactDTO]) -> list[Finding]:
    """Flags near-misses of approved names ("Meera Ragavan" for "Meera Raghavan")."""
    tokens = [(m.start(), m.end()) for m in re.finditer(r"[^\s,;:()]+", text)]
    clean = [re.sub(r"[^\w]", "", text[s:e]).lower() for s, e in tokens]
    out: list[Finding] = []
    taken: list[tuple[int, int]] = []
    for f in facts:
        if f.kind != "name":
            continue
        targets = {f.value, HONORIFICS.sub("", f.value)}
        for target in sorted(targets, key=len, reverse=True):
            parts = [re.sub(r"[^\w]", "", p).lower() for p in target.split()]
            parts = [p for p in parts if p]
            want = " ".join(parts)
            n = len(parts)
            for i in range(len(tokens) - n + 1):
                window = " ".join(clean[i:i + n])
                if not window or window == want:
                    continue
                if window[0] != want[0]:
                    continue
                ratio = SequenceMatcher(None, window, want).ratio()
                s, e = tokens[i][0], tokens[i + n - 1][1]
                while e > s and not text[e - 1].isalnum():
                    e -= 1
                if ratio >= 0.85 and not any(overlaps((s, e), t) for t in taken):
                    taken.append((s, e))
                    out.append(Finding(
                        kind="violation", category="fact", severity="high", origins=["rule"],
                        start=s, end=e, quote=text[s:e],
                        explanation=f'This looks like a misspelling of "{target}" ({f.subject}).',
                        source=_fact_source(f), fix=Fix(start=s, end=e, replacement=target),
                    ))
    return out


def _parse_dates(stext: str) -> list[tuple[int, int, int, int, int | None]]:
    """(start, end, day, month, year|None) for each date expression in a sentence."""
    found = []
    for m in DATE_DMY.finditer(stext):
        found.append((m.start(), m.end(), int(m.group(1)), MONTHS[m.group(2)[:3].lower()], int(m.group(3)) if m.group(3) else None))
    for m in DATE_MDY.finditer(stext):
        if any(overlaps((m.start(), m.end()), (a, b)) for a, b, *_ in found):
            continue
        found.append((m.start(), m.end(), int(m.group(2)), MONTHS[m.group(1)[:3].lower()], int(m.group(3)) if m.group(3) else None))
    for m in DATE_NUM.finditer(stext):
        found.append((m.start(), m.end(), int(m.group(1)), int(m.group(2)), int(m.group(3))))
    return found


def check_dates(text: str, sents: list[tuple[int, int]], facts: list[FactDTO], rules: list[RuleDTO],
                as_of: date) -> list[Finding]:
    date_facts = [f for f in facts if f.kind == "date" and is_current(f, as_of)]
    if not date_facts:
        return []
    mentions = find_mentions(text, subject_names(date_facts, rules))
    out: list[Finding] = []
    for sentence in sents:
        stext = text[sentence[0]:sentence[1]]
        for a, b, day, month, year in _parse_dates(stext):
            s, e = sentence[0] + a, sentence[0] + b
            subject = _nearest_subject(s, sentence, mentions)
            fact = next((f for f in date_facts if normalize(f.subject) == subject), None)
            if not fact:
                continue
            want = date.fromisoformat(fact.value)
            if (day, month) != (want.day, want.month) or (year is not None and year != want.year):
                shown = f"{want.day} {MONTH_NAMES[want.month - 1]}" + (f" {want.year}" if year is not None else "")
                out.append(Finding(
                    kind="violation", category="fact", severity="high", origins=["rule"],
                    start=s, end=e, quote=text[s:e],
                    explanation=f"The approved {fact.attribute} for {fact.subject} is {want.day} {MONTH_NAMES[want.month - 1]} {want.year}.",
                    source=_fact_source(fact), fix=Fix(start=s, end=e, replacement=shown),
                ))
    return out


def check_facts(text: str, sents: list[tuple[int, int]], facts: list[FactDTO], rules: list[RuleDTO],
                as_of: date) -> list[Finding]:
    return [
        *check_numbers(text, sents, facts, rules, as_of),
        *check_names(text, [f for f in facts if is_current(f, as_of)]),
        *check_dates(text, sents, facts, rules, as_of),
    ]
