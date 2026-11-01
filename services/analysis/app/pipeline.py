"""The review pipeline: rules and fact checks first, then grounded AI judgement, citation check,
merge, and rewrites."""

from __future__ import annotations

import logging
import time
from datetime import date

from .config import Settings
from .contract import AnalyzeRequest, AnalyzeResponse, Stats
from .facts import check_facts
from .findings import Finding, assign_fingerprints
from .indic import detect_language
from .judgement import JudgementStats, judge
from .llm import LLM, LLMError, time_budget
from .merge import merge
from .retrieval import Retriever
from .rewrite import propose_rewrites
from .rules import repeated_words, run_rules
from .text import sentence_spans

log = logging.getLogger(__name__)


def analyze(req: AnalyzeRequest, llm: LLM | None, retriever: Retriever | None, settings: Settings) -> AnalyzeResponse:
    with time_budget(settings.analysis_budget_s):
        return analyze_text(req, llm, retriever, settings)


def analyze_text(req: AnalyzeRequest, llm: LLM | None, retriever: Retriever | None, settings: Settings,
                 rewrites: bool = True) -> AnalyzeResponse:
    """The text review, inside the caller's time budget. Image review reuses it on the text in the
    image, without sentence rewrites (the writer changes the image, not a sentence)."""
    started = time.perf_counter()
    text = req.content.text
    channel = req.content.channel
    kit = req.brand_kit
    as_of = date.fromisoformat(req.options.as_of) if req.options.as_of else date.today()
    clauses = {c.code: c for c in kit.clauses}
    sents = sentence_spans(text)
    # Hindi and Hinglish drafts are matched across scripts and spelling variants.
    language = detect_language(text)
    any_script = language != "en"

    # 1. Deterministic checks decide everything checkable.
    rule_findings = (run_rules(text, sents, kit.rules, channel, clauses, any_script)
                     + check_facts(text, sents, kit.facts, kit.rules, as_of, any_script) + repeated_words(text))

    # 2. Judgement checks, only when allowed for this content and a model is configured.
    ai_findings: list[Finding] = []
    jstats = JudgementStats()
    ai_status, ai_error, model = "disabled", None, None
    if req.options.ai:
        if llm is None:
            ai_status, ai_error = "unavailable", "No language model is configured (GEMINI_API_KEY is not set)"
        else:
            model = llm.model
            try:
                ai_findings, jstats = judge(text, channel, req.org_id, kit.clauses, kit.facts, as_of, llm, retriever,
                                            settings.retrieval_top_k, settings.ai_min_confidence, language)
                ai_status = "ok"
            except LLMError as e:
                log.warning("AI judgement unavailable: %s", e)
                ai_status, ai_error = "unavailable", str(e)

    findings, merged = merge(rule_findings, ai_findings, sents)
    assign_fingerprints(findings)
    findings.sort(key=lambda f: (f.start if f.start is not None else -1, f.end or 0))

    proposed = []
    if rewrites and ai_status == "ok" and llm is not None:
        proposed = propose_rewrites(text, channel, findings, kit, as_of, llm, language)

    return AnalyzeResponse(
        findings=[f.to_dto() for f in findings],
        rewrites=proposed,
        ai_status=ai_status,  # type: ignore[arg-type]
        ai_error=ai_error,
        model=model,
        stats=Stats(
            rule_findings=len(rule_findings),
            ai_findings=jstats.found,
            ai_downgraded=jstats.downgraded,
            ai_dropped_unanchored=jstats.dropped_unanchored,
            merged=merged,
            language=language,
            duration_ms=int((time.perf_counter() - started) * 1000),
        ),
    )
