"""Merges findings so one problem is reported once, even when a rule and the AI both see it."""

from __future__ import annotations

import re
from collections.abc import Sequence

from .findings import Finding
from .text import overlaps, sentence_at

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


def _same_fact_same_sentence(a: Finding, b: Finding, sents: Sequence[tuple[int, int]]) -> bool:
    """Both cite the same fact in one sentence: the rule flags the wrong figure ("150 ml"), the AI often
    anchors the same problem on the product name next to it."""
    if not (a.span and b.span and a.source and b.source):
        return False
    if a.source.type != "fact" or b.source.type != "fact" or a.source.code != b.source.code:
        return False
    sentence = sentence_at(list(sents), a.span[0])
    return sentence is not None and sentence == sentence_at(list(sents), b.span[0])


def _same_problem(a: Finding, b: Finding, sents: Sequence[tuple[int, int]] = ()) -> bool:
    if _same_fact_same_sentence(a, b, sents):
        return True
    if not (a.span and b.span and overlaps(a.span, b.span)):
        return False
    # The exact same words are one problem even when the AI files it under another category
    # (the repeated-word rule says "readability", the AI often says "style").
    if a.span == b.span:
        return True
    return (a.grounding is not None and a.grounding == b.grounding) or a.category == b.category


def merge(rule_findings: list[Finding], ai_findings: list[Finding],
          sents: Sequence[tuple[int, int]] = ()) -> tuple[list[Finding], int]:
    merged = 0
    kept_ai: list[Finding] = []
    # Grounded AI findings first, so a violation wins over a "needs human check" on the same words.
    for a in sorted(ai_findings, key=lambda f: (f.kind != "violation", -f.confidence)):
        target = next((r for r in rule_findings if _same_problem(r, a, sents)), None)
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
        if any(_same_problem(k, a, sents) for k in kept_ai):
            merged += 1
            continue
        kept_ai.append(a)
    return rule_findings + kept_ai, merged


def drop_dead_end_fixes(findings: list[Finding], text: str) -> None:
    """Removes a fix that only changes capitals when another problem sits on the same words.

    "MIRACLE" breaks both the capitals rule and the hype-word rule. Lowering it to "miracle" leaves
    the hype word in place, and both fixes change the same text, so the writer could apply only one.
    The other finding's fix (or a rewrite) settles both problems.
    """
    for f in findings:
        if f.fix is None:
            continue
        before = text[f.fix.start:f.fix.end]
        if f.fix.replacement == before or f.fix.replacement.casefold() != before.casefold():
            continue
        if any(g is not f and g.kind == "violation" and g.span and f.fix.start <= g.span[0] and g.span[1] <= f.fix.end
               and not (g.fix and g.fix.replacement.casefold() == text[g.fix.start:g.fix.end].casefold())
               for g in findings):
            f.fix = None
            f.explanation = f"{f.explanation} Fixing the other problem on these words fixes this too."
