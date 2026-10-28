"""Merges findings so one problem is reported once, even when a rule and the AI both see it."""

from __future__ import annotations

import re

from .findings import Finding
from .text import overlaps

_STOP = {"a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "is", "are", "be", "it", "as",
         "this", "that", "do", "not", "no", "any", "so", "with", "by", "its", "they", "them", "which"}
_COVERED = 0.75


def _words(sentence: str) -> set[str]:
    out = set()
    for w in re.findall(r"[^\W_]+", sentence.lower()):
        if w in _STOP:
            continue
        out.add(w[:-1] if len(w) > 3 and w.endswith("s") else w)
    return out


def _covers(a: set[str], b: set[str]) -> bool:
    """True when `a` contains most of `b`'s words, i.e. a sentence saying `a` already says `b`."""
    return bool(b) and len(a & b) / len(b) >= _COVERED


def _add_explanation(current: str, extra: str) -> str:
    """Adds the AI's sentences to a rule's explanation without saying the same thing twice.

    An AI sentence that restates one of the rule's sentences replaces it (the AI's wording usually
    carries the reason too); one the rule already says is dropped; anything new is appended.
    """
    sentences = re.split(r"(?<=[.!?])\s+", current.strip())
    for s in re.split(r"(?<=[.!?])\s+", extra.strip()):
        w = _words(s)
        if not w or _covers(_words(" ".join(sentences)), w):
            continue
        i = next((i for i, t in enumerate(sentences) if _covers(w, _words(t))), None)
        if i is None:
            sentences.append(s)
        else:
            sentences[i] = s
    return " ".join(sentences)


def _same_problem(a: Finding, b: Finding) -> bool:
    if not (a.span and b.span and overlaps(a.span, b.span)):
        return False
    return (a.grounding is not None and a.grounding == b.grounding) or a.category == b.category


def merge(rule_findings: list[Finding], ai_findings: list[Finding]) -> tuple[list[Finding], int]:
    merged = 0
    kept_ai: list[Finding] = []
    # Grounded AI findings first, so a violation wins over a "needs human check" on the same words.
    for a in sorted(ai_findings, key=lambda f: (f.kind != "violation", -f.confidence)):
        target = next((r for r in rule_findings if _same_problem(r, a)), None)
        if target is not None:
            # The rule's citation is deterministic, so it stays; the AI adds its origin and maybe a fix.
            if "ai" not in target.origins:
                target.origins.append("ai")
            # The AI often names more of the problem than the rule does ("in 7 days" next to "guaranteed").
            if a.kind == "violation" and a.explanation:
                target.explanation = _add_explanation(target.explanation, a.explanation)
            if target.fix is None and a.fix is not None:
                target.fix = a.fix
            merged += 1
            continue
        if any(_same_problem(k, a) for k in kept_ai):
            merged += 1
            continue
        kept_ai.append(a)
    return rule_findings + kept_ai, merged
