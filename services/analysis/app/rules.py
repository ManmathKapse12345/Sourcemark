"""Deterministic rule checks. These decide everything that can be checked without judgement."""

from __future__ import annotations

import re
from collections.abc import Callable

from .contract import ClauseDTO, Fix, RuleDTO
from .findings import Finding, rule_source
from .text import find_term, overlaps, sentence_at, term_pattern, word_count

Spans = list[tuple[int, int]]
Check = Callable[[str, Spans, RuleDTO, str, dict[str, ClauseDTO]], list[Finding]]


def _finding(rule: RuleDTO, clauses: dict[str, ClauseDTO], category: str, start: int | None, end: int | None,
             text: str, explanation: str, fix: Fix | None = None) -> Finding:
    return Finding(
        kind="violation",
        category=category,
        severity=rule.severity,
        origins=["rule"],
        start=start,
        end=end,
        quote=text[start:end] if start is not None and end is not None else "",
        explanation=f"{explanation} {rule.message}".strip(),
        source=rule_source(rule, clauses),
        fix=fix,
    )


def banned_term(text: str, sents: Spans, rule: RuleDTO, channel: str, clauses: dict[str, ClauseDTO]) -> list[Finding]:
    terms: list[str] = rule.config.get("terms", [])
    replacement = rule.config.get("replacement")
    category = rule.config.get("category", "claim")
    hits: list[tuple[int, int]] = []
    # Longest terms first, so "skin lightening" wins over "lightening" on the same words.
    for term in sorted(terms, key=len, reverse=True):
        for span in find_term(text, term):
            if not any(overlaps(span, h) for h in hits):
                hits.append(span)
    out = []
    for s, e in sorted(hits):
        fix = Fix(start=s, end=e, replacement=replacement) if replacement else None
        out.append(_finding(rule, clauses, category, s, e, text, f'"{text[s:e]}" is not allowed.', fix))
    return out


def terminology(text: str, sents: Spans, rule: RuleDTO, channel: str, clauses: dict[str, ClauseDTO]) -> list[Finding]:
    preferred: str = rule.config["preferred"]
    variants: list[str] = rule.config.get("variants", [])
    correct = find_term(text, preferred)  # case-insensitive
    out: list[Finding] = []
    taken: list[tuple[int, int]] = []
    for variant in sorted(variants, key=len, reverse=True):
        for span in find_term(text, variant):
            if any(overlaps(span, c) for c in correct) or any(overlaps(span, t) for t in taken):
                continue
            taken.append(span)
            s, e = span
            out.append(_finding(rule, clauses, "terminology", s, e, text,
                                f'Use "{preferred}" instead of "{text[s:e]}".',
                                Fix(start=s, end=e, replacement=preferred)))
    # Exact casing matters only for names that contain capitals ("Northfern", not "sign up").
    if any(ch.isupper() for ch in preferred):
        for s, e in correct:
            if text[s:e] != preferred:
                out.append(_finding(rule, clauses, "terminology", s, e, text,
                                    f'Write "{preferred}" exactly, not "{text[s:e]}".',
                                    Fix(start=s, end=e, replacement=preferred)))
    return out


_WORD = re.compile(r"(?<![\w#@/.])[^\W\d_]+(?:['’][^\W\d_]+)?(?![\w/])")


def all_caps(text: str, sents: Spans, rule: RuleDTO, channel: str, clauses: dict[str, ClauseDTO]) -> list[Finding]:
    min_len = int(rule.config.get("min_length", 3))
    allow = {a.upper() for a in rule.config.get("allow", [])}
    words = [
        (m.start(), m.end())
        for m in _WORD.finditer(text)
        if len(m.group()) >= min_len and m.group().isupper() and m.group().upper() not in allow
    ]
    # Adjacent shouted words ("BUY NOW") become one finding.
    groups: list[list[int]] = []
    for s, e in words:
        if groups and text[groups[-1][1]:s].strip() == "":
            groups[-1][1] = e
        else:
            groups.append([s, e])
    out = []
    for s, e in groups:
        sentence = sentence_at(sents, s)
        lowered = text[s:e].lower()
        if sentence and sentence[0] == s:
            lowered = lowered[:1].upper() + lowered[1:]
        out.append(_finding(rule, clauses, "style", s, e, text, f'"{text[s:e]}" is written in capitals for emphasis.',
                            Fix(start=s, end=e, replacement=lowered)))
    return out


def punctuation(text: str, sents: Spans, rule: RuleDTO, channel: str, clauses: dict[str, ClauseDTO]) -> list[Finding]:
    allowed = int(rule.config.get("max_exclamations", 1))
    out = []
    for i, m in enumerate(re.finditer(r"!+", text)):
        s, e = m.span()
        if i >= allowed:
            out.append(_finding(rule, clauses, "style", s, e, text,
                                f"Too many exclamation marks (at most {allowed} per piece).",
                                Fix(start=s, end=e, replacement=".")))
        elif e - s > 1:
            out.append(_finding(rule, clauses, "style", s, e, text, "Repeated exclamation marks.",
                                Fix(start=s, end=e, replacement="!")))
    return out


def long_sentence(text: str, sents: Spans, rule: RuleDTO, channel: str, clauses: dict[str, ClauseDTO]) -> list[Finding]:
    limit = int(rule.config.get("max_words", 30))
    out = []
    for s, e in sents:
        n = word_count(text[s:e])
        if n > limit:
            out.append(_finding(rule, clauses, "readability", s, e, text,
                                f"This sentence has {n} words (limit {limit})."))
    return out


def required_disclosure(text: str, sents: Spans, rule: RuleDTO, channel: str, clauses: dict[str, ClauseDTO]) -> list[Finding]:
    if channel not in rule.config.get("channels", []):
        return []
    tags: list[str] = rule.config.get("any_of", [])
    hits = sorted(m.span() for tag in tags for m in term_pattern(tag).finditer(text))
    if not hits:
        return [_finding(rule, clauses, "disclosure", None, None, text,
                         f"This {channel.replace('_', ' ')} has no disclosure ({' or '.join(tags)}).",
                         Fix(start=0, end=0, replacement=f"{tags[0]} "))]
    if rule.config.get("at_start", True):
        first_sentence_end = sents[0][1] if sents else len(text)
        s, e = hits[0]
        if s >= first_sentence_end:
            return [_finding(rule, clauses, "disclosure", s, e, text,
                             f'The disclosure "{text[s:e]}" must come at the start, not later in the text.')]
    return []


CHECKS: dict[str, Check] = {
    "banned_term": banned_term,
    "terminology": terminology,
    "all_caps": all_caps,
    "punctuation": punctuation,
    "long_sentence": long_sentence,
    "required_disclosure": required_disclosure,
}


def run_rules(text: str, sents: Spans, rules: list[RuleDTO], channel: str, clauses: dict[str, ClauseDTO]) -> list[Finding]:
    out: list[Finding] = []
    for rule in rules:
        out.extend(CHECKS[rule.type](text, sents, rule, channel, clauses))
    return out
