"""Merges findings so one problem is reported once, even when a rule and the AI both see it."""

from __future__ import annotations

from .findings import Finding
from .text import overlaps


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
            if a.kind == "violation" and a.explanation and a.explanation not in target.explanation:
                target.explanation = f"{target.explanation} {a.explanation}"
            if target.fix is None and a.fix is not None:
                target.fix = a.fix
            merged += 1
            continue
        if any(_same_problem(k, a) for k in kept_ai):
            merged += 1
            continue
        kept_ai.append(a)
    return rule_findings + kept_ai, merged
