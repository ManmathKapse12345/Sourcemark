"""Scores the analysis pipeline on the labelled test set.

    python eval/run.py --no-ai     # rules and fact checks only (deterministic, no API key)
    python eval/run.py             # full pipeline with Gemini (needs GEMINI_API_KEY)

Reports precision, recall, the false-alarm rate on clean pieces, citation validity and timing,
and writes a JSON report to eval/results/.

Matching: a predicted violation matches an expected one when it rests on the same clause or
fact (a rule's clause counts) and overlaps one of the expected quotes. Predicted violations that
match an "acceptable" label are neither true nor false positives. "Needs human check" findings
are never counted as violations; they are reported separately.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import statistics
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "services" / "analysis"))

from app.config import Settings  # noqa: E402
from app.contract import AnalyzeRequest, BrandKit, ClauseDTO, FactDTO, RuleDTO  # noqa: E402
from app.facts import fact_text  # noqa: E402
from app.pipeline import analyze  # noqa: E402
from app.retrieval import InMemoryRetriever  # noqa: E402

AS_OF = "2026-10-26"


def load_kit() -> BrandKit:
    raw = json.loads((ROOT / "brand_kit.json").read_text(encoding="utf-8"))
    return BrandKit(
        rules=[RuleDTO(**r) for r in raw["rules"]],
        facts=[FactDTO(**f) for f in raw["facts"]],
        clauses=[ClauseDTO(**c) for c in raw["guideline"]["clauses"]],
    )


def load_tests() -> list[dict]:
    return [json.loads(line) for line in (ROOT / "testset.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]


def settings(ai: bool) -> Settings:
    return Settings(
        internal_token="eval-not-used-0000",
        database_url=None,
        gemini_api_key=os.environ.get("GEMINI_API_KEY") if ai else None,
        gemini_model=os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite"),
        embedding_model=os.environ.get("EMBEDDING_MODEL", "gemini-embedding-001"),
        embedding_dim=int(os.environ.get("EMBEDDING_DIM", "768")),
        retrieval_top_k=int(os.environ.get("RETRIEVAL_TOP_K", "8")),
        ai_min_confidence=float(os.environ.get("AI_MIN_CONFIDENCE", "0.5")),
        gemini_timeout_s=float(os.environ.get("GEMINI_TIMEOUT_S", "45")),
        gemini_max_retries=int(os.environ.get("GEMINI_MAX_RETRIES", "4")),
    )


def clause_vectors(kit: BrandKit, llm) -> dict[str, list[float]]:
    """Embeds clauses once and caches them, like the API does when a guideline is published."""
    texts = [f"{c.heading}: {c.text}" if c.heading else c.text for c in kit.clauses]
    key = hashlib.sha1(json.dumps([llm.embedding_model, llm.dim, texts]).encode()).hexdigest()[:12]
    cache = ROOT / ".cache" / f"clauses-{key}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    vectors = dict(zip([c.code for c in kit.clauses], llm.embed(texts, "document"), strict=True))
    cache.parent.mkdir(exist_ok=True)
    cache.write_text(json.dumps(vectors))
    return vectors


def spans_of(text: str, quotes: list[str]) -> list[tuple[int, int] | None]:
    out: list[tuple[int, int] | None] = []
    for q in quotes:
        if q == "":
            out.append(None)  # document-level
            continue
        pos = text.find(q)
        if pos < 0:
            raise ValueError(f"Label quote {q!r} not found in test text: {text!r}")
        out.append((pos, pos + len(q)))
    return out


def grounding(f) -> str | None:
    return (f.source.clause_code or f.source.code) if f.source else None


def matches(f, label: dict, text: str) -> bool:
    if grounding(f) != label["cite"]:
        return False
    for span in spans_of(text, label["quotes"]):
        if span is None:
            if f.span is None:
                return True
        elif f.span is not None and f.span.start < span[1] and span[0] < f.span.end:
            return True
    return False


def citation_valid(f, kit: BrandKit) -> bool:
    if f.source is None:
        return False
    if f.source.type == "fact":
        fact = next((x for x in kit.facts if x.code == f.source.code), None)
        return fact is not None and fact_text(fact) == f.source.text
    code = f.source.clause_code if f.source.type == "rule" else f.source.code
    rule = next((r for r in kit.rules if r.code == f.source.code), None) if f.source.type == "rule" else None
    if code is None:
        return rule is not None and f.source.text == rule.message
    clause = next((c for c in kit.clauses if c.code == code), None)
    return clause is not None and clause.text == f.source.text


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-ai", action="store_true", help="rules and fact checks only")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--verbose", "-v", action="store_true")
    args = ap.parse_args()

    use_ai = not args.no_ai
    if use_ai and not os.environ.get("GEMINI_API_KEY"):
        sys.exit("GEMINI_API_KEY is not set. Use --no-ai for the rules-only baseline.")
    cfg = settings(use_ai)
    kit = load_kit()
    tests = load_tests()[: args.limit]

    llm = retriever = None
    if use_ai:
        from app.llm import GeminiLLM

        llm = GeminiLLM(cfg)
        retriever = InMemoryRetriever(clause_vectors(kit, llm))

    tp = fp = fn = acceptable = nhc = 0
    by_need = {"rule": [0, 0], "ai": [0, 0]}  # [found, total]
    clean_with_alarm = clean_total = 0
    invalid_citations = 0
    durations: list[int] = []
    ai_failures = 0
    pieces = []

    for t in tests:
        req = AnalyzeRequest(org_id="eval", content={"text": t["text"], "channel": t["channel"]},
                             brand_kit=kit, options={"ai": use_ai, "as_of": AS_OF})
        res = analyze(req, llm, retriever, cfg)
        durations.append(res.stats.duration_ms)
        if use_ai and res.ai_status != "ok":
            ai_failures += 1
        violations = [f for f in res.findings if f.kind == "violation"]
        nhc += sum(1 for f in res.findings if f.kind == "needs_human_check")
        invalid_citations += sum(1 for f in violations if not citation_valid(f, kit))

        used: set[int] = set()
        missed = []
        for label in t["expected"]:
            need = label.get("needs", "rule")
            by_need[need][1] += 1
            hit = next((i for i, f in enumerate(violations) if i not in used and matches(f, label, t["text"])), None)
            if hit is None:
                fn += 1
                missed.append(label)
            else:
                used.add(hit)
                tp += 1
                by_need[need][0] += 1
        false_alarms = []
        for i, f in enumerate(violations):
            if i in used:
                continue
            if any(matches(f, a, t["text"]) for a in t.get("acceptable", [])):
                acceptable += 1
            else:
                fp += 1
                false_alarms.append(f)
        if not t["expected"]:
            clean_total += 1
            clean_with_alarm += 1 if false_alarms else 0

        pieces.append({
            "id": t["id"],
            "ai_status": res.ai_status,
            "missed": missed,
            "false_alarms": [f.model_dump() for f in false_alarms],
            "findings": [f.model_dump() for f in res.findings],
            "rewrites": [r.model_dump() for r in res.rewrites],
        })
        if args.verbose and (missed or false_alarms):
            print(f"\n{t['id']}: {t['text']}")
            for m in missed:
                print(f"  MISSED  {m['cite']} {m['quotes'][0]!r}")
            for f in false_alarms:
                print(f"  FALSE   {grounding(f)} {f.quote!r} ({','.join(f.origins)}): {f.explanation}")

    precision = tp / (tp + fp) if tp + fp else 1.0
    recall = tp / (tp + fn) if tp + fn else 1.0
    summary = {
        "mode": "full (rules + AI)" if use_ai else "rules only",
        "model": cfg.gemini_model if use_ai else None,
        "pieces": len(tests),
        "precision": round(precision, 3),
        "recall": round(recall, 3),
        "recall_rule_checkable": round(by_need["rule"][0] / by_need["rule"][1], 3) if by_need["rule"][1] else None,
        "recall_judgement": round(by_need["ai"][0] / by_need["ai"][1], 3) if by_need["ai"][1] else None,
        "true_positives": tp,
        "false_positives": fp,
        "false_negatives": fn,
        "acceptable_extra": acceptable,
        "needs_human_check": nhc,
        "false_alarm_rate_clean": round(clean_with_alarm / clean_total, 3) if clean_total else None,
        "clean_pieces": clean_total,
        "invalid_citations": invalid_citations,
        "ai_failures": ai_failures,
        "median_ms": int(statistics.median(durations)) if durations else 0,
        "p95_ms": int(sorted(durations)[max(0, int(len(durations) * 0.95) - 1)]) if durations else 0,
    }

    print("\nSourcemark evaluation")
    for k, v in summary.items():
        print(f"  {k:24} {v}")
    out_dir = ROOT / "results"
    out_dir.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    path = out_dir / f"{stamp}-{'full' if use_ai else 'rules'}.json"
    path.write_text(json.dumps({"summary": summary, "pieces": pieces}, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nReport: {path}")


if __name__ == "__main__":
    main()
