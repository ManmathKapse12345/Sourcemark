"""Scores the analysis pipeline on the labelled test set.

    python eval/run.py --no-ai              # rules and fact checks only (deterministic, no API key)
    python eval/run.py                      # full pipeline with Gemini (needs GEMINI_API_KEY)
    python eval/run.py --set hi [--no-ai]   # the Hindi and Hinglish set (testset_hi.jsonl)
    python eval/run.py --set images [--no-ai]  # image review (testset_images.jsonl, eval/images/)

Reports precision, recall, the false-alarm rate on clean pieces, citation validity and timing,
and writes a JSON report to eval/results/.

Matching: a predicted violation matches an expected one when it rests on the same clause or
fact (a rule's clause counts) and overlaps one of the expected quotes. Predicted violations that
match an "acceptable" label are neither true nor false positives. "Needs human check" findings
are never counted as violations; they are reported separately.
"""

from __future__ import annotations

import argparse
import base64
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


SETS = {"en": "testset.jsonl", "hi": "testset_hi.jsonl", "images": "testset_images.jsonl"}


def load_tests(name: str = "en") -> list[dict]:
    path = ROOT / SETS[name]
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


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
    ap.add_argument("--set", choices=sorted(SETS), default="en", help="en: English, hi: Hindi and Hinglish, images: image review")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--verbose", "-v", action="store_true")
    args = ap.parse_args()

    use_ai = not args.no_ai
    if use_ai and not os.environ.get("GEMINI_API_KEY"):
        sys.exit("GEMINI_API_KEY is not set. Use --no-ai for the rules-only baseline.")
    cfg = settings(use_ai)
    kit = load_kit()
    tests = load_tests(args.set)[: args.limit]

    llm = retriever = None
    if use_ai:
        from app.llm import GeminiLLM

        llm = GeminiLLM(cfg)
        retriever = InMemoryRetriever(clause_vectors(kit, llm))

    if args.set == "images":
        return run_images(tests, kit, cfg, llm, retriever, use_ai, args.verbose)

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
        "set": args.set,
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

    report(summary, pieces, args.set, use_ai)


def report(summary: dict, pieces: list, set_name: str, use_ai: bool) -> None:
    print("\nSourcemark evaluation")
    for k, v in summary.items():
        print(f"  {k:24} {v}")
    out_dir = ROOT / "results"
    out_dir.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    suffix = "" if set_name == "en" else f"-{set_name}"
    path = out_dir / f"{stamp}-{'full' if use_ai else 'rules'}{suffix}.json"
    path.write_text(json.dumps({"summary": summary, "pieces": pieces}, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nReport: {path}")


# Image review: the demo palette and the logo file stand in for the brand kit's assets.
PALETTE = ["#1F4D3A", "#F4EFE6", "#C9A66B", "#2B2B2B"]


def image_assets() -> list:
    from app.contract import ImageAsset

    logo = base64.b64encode((ROOT / "images" / "northfern-logo.png").read_bytes()).decode()
    return [ImageAsset(code="A-1", name="Northfern palette", type="palette", colors=PALETTE),
            ImageAsset(code="A-2", name="Northfern logo", type="logo", colors=[], image_b64=logo)]


def image_match(f, label: dict) -> bool:
    """Same check and citation; where the label names words (a logo problem, the text with low contrast or
    a wrong price), the finding must be about them."""
    if grounding(f) != label["cite"]:
        return False
    quote = label.get("quote")
    return not quote or quote.lower() in f.quote.lower() or (bool(f.quote) and f.quote.lower() in quote.lower())


def run_images(tests: list[dict], kit: BrandKit, cfg: Settings, llm, retriever, use_ai: bool, verbose: bool) -> None:
    from app.contract import ImageAnalyzeRequest
    from app.images import analyze_image

    assets = image_assets()
    tp = fp = fn = nhc = ai_failures = acceptable = 0
    by_need = {"rule": [0, 0], "ai": [0, 0]}
    clean_with_alarm = clean_total = 0
    durations: list[int] = []
    pieces = []
    for t in tests:
        req = ImageAnalyzeRequest(org_id="eval", channel=t["channel"], alt_text=t["alt_text"], brand_kit=kit,
                                  assets=assets, options={"ai": use_ai, "as_of": AS_OF})
        res = analyze_image(req, (ROOT / t["file"]).read_bytes(), llm, retriever, cfg)
        durations.append(res.stats.duration_ms)
        if use_ai and res.ai_status != "ok":
            ai_failures += 1
        violations = [f for f in res.findings if f.kind == "violation"]
        nhc += sum(1 for f in res.findings if f.kind == "needs_human_check")
        # Without AI the text in the image is not read, so those labels are out of scope for that run.
        # "acceptable" labels are borderline: a matching finding is neither credited nor penalised.
        in_scope = [e for e in t["expected"] if use_ai or e.get("needs", "rule") == "rule"]
        expected = [e for e in in_scope if not e.get("acceptable")]
        acceptable_labels = [e for e in in_scope if e.get("acceptable")]
        used: set[int] = set()
        missed = []
        for label in expected:
            need = label.get("needs", "rule")
            by_need[need][1] += 1
            hit = next((i for i, f in enumerate(violations) if i not in used and image_match(f, label)), None)
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
            if any(image_match(f, a) for a in acceptable_labels):
                acceptable += 1
            else:
                false_alarms.append(f)
        fp += len(false_alarms)
        if not any(not e.get("acceptable") for e in t["expected"]):
            clean_total += 1
            clean_with_alarm += 1 if false_alarms else 0
        pieces.append({"id": t["id"], "ai_status": res.ai_status, "ocr_text": res.ocr_text, "missed": missed,
                       "false_alarms": [f.model_dump() for f in false_alarms], "findings": [f.model_dump() for f in res.findings]})
        if verbose and (missed or false_alarms):
            print(f"\n{t['id']}: {res.ocr_text!r}")
            for m in missed:
                print(f"  MISSED  {m['cite']} {m.get('quote', m['check'])!r}")
            for f in false_alarms:
                print(f"  FALSE   {grounding(f)} {f.quote!r}: {f.explanation}")

    summary = {
        "set": "images",
        "mode": "full (rules + AI)" if use_ai else "deterministic checks only (colours, logos, alt text)",
        "model": cfg.gemini_model if use_ai else None,
        "pieces": len(tests),
        "precision": round(tp / (tp + fp), 3) if tp + fp else 1.0,
        "recall": round(tp / (tp + fn), 3) if tp + fn else 1.0,
        "recall_rule_checkable": round(by_need["rule"][0] / by_need["rule"][1], 3) if by_need["rule"][1] else None,
        "recall_needs_ai": round(by_need["ai"][0] / by_need["ai"][1], 3) if by_need["ai"][1] else None,
        "true_positives": tp,
        "false_positives": fp,
        "false_negatives": fn,
        "acceptable_extra": acceptable,
        "needs_human_check": nhc,
        "false_alarm_rate_clean": round(clean_with_alarm / clean_total, 3) if clean_total else None,
        "clean_pieces": clean_total,
        "ai_failures": ai_failures,
        "median_ms": int(statistics.median(durations)) if durations else 0,
        "p95_ms": int(sorted(durations)[max(0, int(len(durations) * 0.95) - 1)]) if durations else 0,
    }
    report(summary, pieces, "images", use_ai)


if __name__ == "__main__":
    main()
