"""No citation, no violation: an AI finding stays a violation only if it cites a real source
and quotes it accurately. Everything else becomes "needs human check"."""

from __future__ import annotations

from .contract import ClauseDTO, FactDTO, FindingSource
from .facts import fact_text
from .text import normalize

MIN_QUOTE_CHARS = 15


def verify_citation(source_id: str | None, source_quote: str | None, clauses: dict[str, ClauseDTO],
                    facts: dict[str, FactDTO]) -> tuple[FindingSource | None, str | None]:
    """Returns (source, None) when the citation holds, or (None, reason) when it does not."""
    if not source_id:
        return None, "no approved source was cited"
    quote = normalize(source_quote or "")

    clause = clauses.get(source_id)
    if clause:
        body = normalize(clause.text)
        if not quote:
            return None, f"{source_id} was cited without quoting it"
        if quote not in body and quote not in normalize(f"{clause.heading or ''} {clause.text}"):
            return None, f"the quoted text does not appear in {source_id}"
        if len(quote) < min(MIN_QUOTE_CHARS, len(body)):
            return None, f"the quote from {source_id} is too short to show it applies"
        return FindingSource(type="clause", code=clause.code, clause_code=clause.code, text=clause.text), None

    fact = facts.get(source_id)
    if fact:
        text = fact_text(fact)
        if quote and (quote in normalize(text) or normalize(fact.value) in quote):
            return FindingSource(type="fact", code=fact.code, clause_code=None, text=text), None
        return None, f"the quoted text does not match fact {source_id}"

    return None, f"{source_id} is not in this organisation's brand kit"
