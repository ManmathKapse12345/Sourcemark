from __future__ import annotations

import json

from conftest import REPO, make_request

from app.contract import ExtractedClause
from app.parsing import extract_clauses
from app.pipeline import analyze
from app.text import sentence_spans


def codes(res):
    return sorted((f.source.clause_code or f.source.code, f.quote) for f in res.findings if f.kind == "violation")


def test_sentence_split_keeps_abbreviations_and_initials():
    text = "Join Dr. Sanjay Iyer on 14 Nov. Bring a friend! A. Rao will host."
    assert [text[a:b] for a, b in sentence_spans(text)] == [
        "Join Dr. Sanjay Iyer on 14 Nov. Bring a friend!",
        "A. Rao will host.",
    ]


def test_demo_caption_from_the_plan(kit, settings):
    res = analyze(make_request(kit, "Our Calm Barrier Cream is a MIRACLE, now just ₹499!!"), None, None, settings)
    assert codes(res) == [
        ("F-2", "₹499"),
        ("G-1.2", "MIRACLE"),
        ("G-1.3", "!!"),
        ("G-2.1", "Calm Barrier Cream"),
        ("G-3.1", "MIRACLE"),
    ]
    price = next(f for f in res.findings if f.source.code == "F-2")
    assert "₹499 was the approved value until 2026-06-30" in price.explanation
    assert price.fix.replacement == "₹549"
    assert res.ai_status == "disabled"


def test_numbers_are_only_compared_in_context(kit, settings):
    # A figure about something else is not checked against a product fact.
    res = analyze(make_request(kit, "Northfern has 100,000 customers. Calm Barrier Moisturiser is ₹549."), None, None, settings)
    assert codes(res) == []
    # A threshold amount is not the product's price.
    res = analyze(make_request(kit, "Free Gentle Oat Cleanser travel size with every order above ₹999."), None, None, settings)
    assert codes(res) == []
    # Each number belongs to the nearest product mentioned before it.
    res = analyze(make_request(kit, "Gentle Oat Cleanser is ₹349 and Calm Barrier Moisturiser is ₹499."), None, None, settings)
    assert codes(res) == [("F-2", "₹499")]


def test_quantity_name_and_date_checks(kit, settings):
    res = analyze(make_request(kit, "Gentle Oat Cleanser now comes in 150 ml."), None, None, settings)
    assert codes(res) == [("F-7", "150 ml")]
    res = analyze(make_request(kit, "Meet our founder, Meera Ragavan."), None, None, settings)
    [f] = res.findings
    assert (f.source.code, f.quote, f.fix.replacement) == ("F-8", "Meera Ragavan", "Meera Raghavan")
    res = analyze(make_request(kit, "The Winter Skin Workshop is on 15 November."), None, None, settings)
    [f] = res.findings
    assert (f.source.code, f.fix.replacement) == ("F-10", "14 November")
    res = analyze(make_request(kit, "See you at the workshop on 14 Nov."), None, None, settings)
    assert res.findings == []


def test_disclosure_and_casing(kit, settings):
    res = analyze(make_request(kit, "Loving my Dew Shield SPF 50 Sunscreen.", channel="creator_post"), None, None, settings)
    [f] = res.findings
    assert f.source.clause_code == "G-5.1" and f.span is None and f.fix.replacement == "#ad "
    res = analyze(make_request(kit, "#ad Loving my Dew Shield SPF 50 Sunscreen.", channel="creator_post"), None, None, settings)
    assert res.findings == []
    res = analyze(make_request(kit, "Shop northfern today."), None, None, settings)
    assert codes(res) == [("G-2.2", "northfern")]


def test_fingerprints_are_stable_when_other_text_changes(kit, settings):
    a = analyze(make_request(kit, "Calm Barrier Cream is great."), None, None, settings)
    b = analyze(make_request(kit, "Hello. Calm Barrier Cream is great."), None, None, settings)
    assert a.findings[0].fingerprint == b.findings[0].fingerprint
    twice = analyze(make_request(kit, "Calm Barrier Cream. Calm Barrier Cream."), None, None, settings)
    assert len({f.fingerprint for f in twice.findings}) == 2


def test_guideline_document_extracts_to_the_demo_clauses():
    md = (REPO / "eval" / "northfern-guidelines.md").read_text(encoding="utf-8")
    clauses, warnings = extract_clauses(md, "G")
    expected = json.loads((REPO / "eval" / "brand_kit.json").read_text(encoding="utf-8"))["guideline"]["clauses"]
    assert clauses == [ExtractedClause(**c) for c in expected]
    assert warnings == []


def test_unnumbered_guidelines_get_section_codes():
    text = "Tone\nBe warm and plain in every message.\n- Never shout at readers in capitals.\n\nPrices\nAlways show prices in rupees."
    clauses, _ = extract_clauses(text, "G2")
    assert [(c.code, c.heading) for c in clauses] == [("G2-1.1", "Tone"), ("G2-1.2", "Tone"), ("G2-2.1", "Prices")]
