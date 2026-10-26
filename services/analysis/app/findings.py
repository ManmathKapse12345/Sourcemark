"""Internal finding model, fingerprints and conversion to the wire format."""

from __future__ import annotations

import hashlib
from collections import Counter
from dataclasses import dataclass, field

from .contract import ClauseDTO, FindingDTO, FindingSource, Fix, RuleDTO, Span
from .text import normalize


@dataclass
class Finding:
    kind: str  # "violation" | "needs_human_check"
    category: str
    severity: str
    origins: list[str]
    start: int | None
    end: int | None
    quote: str
    explanation: str
    source: FindingSource | None
    confidence: float = 1.0
    fix: Fix | None = None
    fingerprint: str = field(default="")

    @property
    def span(self) -> tuple[int, int] | None:
        return (self.start, self.end) if self.start is not None and self.end is not None else None

    @property
    def grounding(self) -> str | None:
        """The clause or fact this finding ultimately rests on (a rule's clause, or the cited code)."""
        if not self.source:
            return None
        return self.source.clause_code or self.source.code

    def to_dto(self) -> FindingDTO:
        return FindingDTO(
            fingerprint=self.fingerprint,
            kind=self.kind,  # type: ignore[arg-type]
            category=self.category,  # type: ignore[arg-type]
            severity=self.severity,  # type: ignore[arg-type]
            origins=sorted(set(self.origins), key=["rule", "ai"].index),  # type: ignore[arg-type]
            span=Span(start=self.start, end=self.end) if self.span else None,
            quote=self.quote,
            explanation=self.explanation,
            source=self.source,
            confidence=round(self.confidence, 3),
            fix=self.fix,
        )


def rule_source(rule: RuleDTO, clauses: dict[str, ClauseDTO]) -> FindingSource:
    clause = clauses.get(rule.clause_code) if rule.clause_code else None
    return FindingSource(
        type="rule",
        code=rule.code,
        clause_code=clause.code if clause else None,
        text=clause.text if clause else rule.message,
    )


def assign_fingerprints(findings: list[Finding]) -> None:
    """Stable id for "the same problem" across versions: source + flagged text + occurrence number.

    Offsets are deliberately left out, so the same problem keeps its fingerprint when text
    elsewhere in the draft changes.
    """
    seen: Counter[str] = Counter()
    for f in sorted(findings, key=lambda f: (f.start if f.start is not None else -1, f.end or 0)):
        key = f"{f.source.type}:{f.source.code}" if f.source else f"ai:{f.category}"
        base = f"{key}|{normalize(f.quote)}"
        seen[base] += 1
        f.fingerprint = hashlib.sha1(f"{base}|{seen[base]}".encode()).hexdigest()[:16]
