"""Wire format shared with the Express API.

Mirrors packages/contract/src/analysis.ts. Both sides are tested against
packages/contract/fixtures, and this service's real output is validated against the
JSON Schema exported from the Zod definitions (tests/test_contract.py).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Channel = Literal[
    "website", "instagram", "creator_post", "linkedin", "x", "youtube", "email", "print", "press_release", "other"
]
RuleType = Literal["banned_term", "terminology", "all_caps", "punctuation", "long_sentence", "required_disclosure"]
FactKind = Literal["money", "quantity", "name", "date", "claim"]
Severity = Literal["high", "medium", "low"]
FindingKind = Literal["violation", "needs_human_check"]
Category = Literal["terminology", "fact", "claim", "tone", "style", "readability", "disclosure", "inclusivity"]
Origin = Literal["rule", "ai"]

ISO_DATE = r"^\d{4}-\d{2}-\d{2}$"


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RuleDTO(Strict):
    code: str
    type: RuleType
    severity: Severity
    clause_code: str | None
    message: str
    config: dict[str, Any]


class FactDTO(Strict):
    code: str
    subject: str
    aliases: list[str]
    attribute: str
    kind: FactKind
    value: str
    unit: str | None
    valid_from: str = Field(pattern=ISO_DATE)
    valid_until: str | None = Field(pattern=ISO_DATE)
    source: str | None


class ClauseDTO(Strict):
    code: str
    heading: str | None
    text: str


class Content(Strict):
    text: str
    channel: Channel


class BrandKit(Strict):
    rules: list[RuleDTO]
    facts: list[FactDTO]
    clauses: list[ClauseDTO]


class Options(Strict):
    ai: bool
    as_of: str | None = Field(pattern=ISO_DATE)


class AnalyzeRequest(Strict):
    org_id: str
    content: Content
    brand_kit: BrandKit
    options: Options


class Span(Strict):
    start: int = Field(ge=0)
    end: int = Field(ge=0)


class FindingSource(Strict):
    type: Literal["rule", "clause", "fact"]
    code: str
    clause_code: str | None
    text: str


class Fix(Strict):
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    replacement: str


class FindingDTO(Strict):
    fingerprint: str
    kind: FindingKind
    category: Category
    severity: Severity
    origins: list[Origin] = Field(min_length=1)
    span: Span | None
    quote: str
    explanation: str
    source: FindingSource | None
    confidence: float = Field(ge=0, le=1)
    fix: Fix | None


class RewriteDTO(Strict):
    id: str
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    original: str
    text: str
    finding_fingerprints: list[str]


class Stats(Strict):
    rule_findings: int
    ai_findings: int
    ai_downgraded: int
    ai_dropped_unanchored: int
    merged: int
    duration_ms: int


class AnalyzeResponse(Strict):
    findings: list[FindingDTO]
    rewrites: list[RewriteDTO]
    ai_status: Literal["ok", "disabled", "unavailable"]
    ai_error: str | None
    model: str | None
    stats: Stats


class ParseResponse(Strict):
    text: str
    format: Literal["pdf", "docx", "txt"]
    warnings: list[str]


class ExtractedClause(Strict):
    code: str
    heading: str | None
    text: str


class ExtractGuidelineResponse(Strict):
    clauses: list[ExtractedClause]
    warnings: list[str]


class EmbedRequest(Strict):
    texts: list[str] = Field(min_length=1)
    task: Literal["document", "query"]


class EmbedResponse(Strict):
    model: str
    dim: int
    vectors: list[list[float]]


class SuggestRulesRequest(Strict):
    clauses: list[ClauseDTO] = Field(min_length=1)


class RuleSuggestion(Strict):
    clause_code: str
    type: RuleType
    severity: Severity
    message: str
    config: dict[str, Any]


class SuggestRulesResponse(Strict):
    suggestions: list[RuleSuggestion]
