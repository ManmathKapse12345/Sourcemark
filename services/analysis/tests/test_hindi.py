"""Hindi (Devanagari) and Hinglish (Hindi in Roman letters) review: matching across scripts and
spelling variants, Indian number formats, sentence splitting, and the language passed to the model."""

from __future__ import annotations

from conftest import FakeLLM, make_request

from app.facts import MONEY, _amount
from app.indic import detect_language, find_term_any_script, phonetic_key, transliterate
from app.pipeline import analyze
from app.text import sentence_spans


def codes(res):
    return sorted((f.source.code if f.source else None, f.quote) for f in res.findings if f.kind == "violation")


def test_transliteration_and_keys_ignore_script_and_spelling():
    assert transliterate("कमल") == "kamal" and transliterate("चमत्कार") == "chamatkaar"
    assert phonetic_key("चमत्कार") == phonetic_key("chamatkaar") == phonetic_key("Chamatkar")
    assert phonetic_key("क्रीम") == phonetic_key("cream") == phonetic_key("kreem")
    # Short words need the same key, so a common verb never matches a banned word.
    assert find_term_any_script("kar lo", "cure") == []
    # Long words may differ in vowels: the Devanagari spelling of an English word still matches.
    assert find_term_any_script("यह एक मिरेकल है", "miracle") == [(6, 12)]


def test_language_detection():
    assert detect_language("यह क्रीम बहुत अच्छी है।") == "hi"
    assert detect_language("Ye cream bahut acchi hai aur sirf 549 mein milegi") == "hinglish"
    assert detect_language("Our cream keeps dry skin comfortable.") == "en"


def test_danda_ends_a_sentence():
    text = "पहला वाक्य। दूसरा वाक्य।"
    assert [text[a:b] for a, b in sentence_spans(text)] == ["पहला वाक्य।", "दूसरा वाक्य।"]


def test_banned_terms_match_in_devanagari_and_hinglish_spellings(kit, settings):
    res = analyze(make_request(kit, "Calm Barrier Moisturiser एक चमत्कार है।"), None, None, settings)
    assert ("R-1", "चमत्कार") in codes(res) and res.stats.language == "hi"

    res = analyze(make_request(kit, "Ye moisturiser ekdum chamatkaari hai aur rang saaf karta hai"), None, None, settings)
    assert {("R-1", "chamatkaari"), ("R-2", "rang saaf")} <= set(codes(res))
    assert res.stats.language == "hinglish"


def test_english_content_keeps_exact_matching(kit, settings):
    # Cross-script matching is only for Hindi and Hinglish; English results do not change.
    res = analyze(make_request(kit, "Calm Barrier Moisturiser keeps dry skin comfortable."), None, None, settings)
    assert codes(res) == [] and res.stats.language == "en"


def test_product_names_in_hinglish_and_devanagari(kit, settings):
    res = analyze(make_request(kit, "Calm Barrier Kreem bahut acchi hai, zaroor lagao"), None, None, settings)
    assert ("R-4", "Calm Barrier Kreem") in codes(res)
    # The approved Devanagari spelling is an alias, not a misspelling to correct.
    res = analyze(make_request(kit, "कॉम बैरियर मॉइस्चराइज़र अब ₹549 में।"), None, None, settings)
    assert codes(res) == []


def test_indian_amounts_are_checked_against_the_fact_sheet(kit, settings):
    cases = {
        "Calm Barrier Moisturiser अब सिर्फ ₹४९९ में।": "₹४९९",            # Devanagari digits
        "Calm Barrier Moisturiser sirf 499 rupaye mein milega": "499 rupaye",
        "Calm Barrier Moisturiser ab sirf Rs. 499 mein": "Rs. 499",
        "कॉम बैरियर मॉइस्चराइज़र सिर्फ रु 499 में।": "रु 499",               # product named in Devanagari
    }
    for text, quote in cases.items():
        res = analyze(make_request(kit, text), None, None, settings)
        [f] = [f for f in res.findings if f.source and f.source.code == "F-2"]
        assert f.quote == quote, text
        assert "until 2026-06-30" in f.explanation and f.fix.replacement == "₹549"


def test_lakh_and_crore_and_amounts_that_are_not_prices(kit, settings):
    assert _amount(MONEY.search("₹1.5 lakh")) == 150_000
    assert _amount(MONEY.search("Rs 2 crore")) == 20_000_000
    assert _amount(MONEY.search("₹1,49,999")) == 149_999
    # "on orders above ₹999" is an order threshold, not the product's price.
    res = analyze(make_request(kit, "Calm Barrier Moisturiser ₹999 से ऊपर के ऑर्डर पर मुफ़्त शिपिंग के साथ।"),
                  None, None, settings)
    assert not [f for f in res.findings if f.category == "fact"]


def test_no_false_repeats_inside_hindi_words(kit, settings):
    res = analyze(make_request(kit, "यह क्रीम मीठी खुशबू वाली है।"), None, None, settings)
    assert not [f for f in res.findings if "twice in a row" in f.explanation]


def test_the_model_is_told_the_language_and_answers_in_it(kit, settings):
    llm = FakeLLM({"AIJudgement": {"issues": [{
        "quote": "एक्ज़िमा ठीक करता है", "type": "violation", "category": "claim", "severity": "high",
        "issue": "यह एक चिकित्सा दावा है।", "source_id": "G-3.2",
        "source_quote": "Do not claim that any product treats, heals, clears or prevents a medical condition",
        "confidence": 0.9, "suggested_fix": "रूखी त्वचा को आराम देता है"}]}})
    res = analyze(make_request(kit, "Gentle Oat Cleanser एक्ज़िमा ठीक करता है।", ai=True), llm, None, settings)
    assert "DRAFT LANGUAGE: Hindi (Devanagari script)" in llm.prompts[0][1]
    [f] = [f for f in res.findings if f.origins == ["ai"]]
    assert f.kind == "violation" and f.source.code == "G-3.2" and f.fix.replacement == "रूखी त्वचा को आराम देता है"


def test_ai_finding_on_the_same_fact_in_the_same_sentence_is_merged(kit, settings):
    # The rule flags the wrong size; the AI anchors the same fact on the product name beside it.
    llm = FakeLLM({"AIJudgement": {"issues": [{
        "quote": "Gentle Oat Cleanser", "type": "violation", "category": "fact", "severity": "high",
        "issue": "The size is wrong.", "source_id": "F-7", "source_quote": "Gentle Oat Cleanser, size: 100 ml",
        "confidence": 0.9, "suggested_fix": None}]}})
    res = analyze(make_request(kit, "Gentle Oat Cleanser का 150 मिली पैक अब ₹349 में।", ai=True), llm, None, settings)
    [f] = [f for f in res.findings if f.source and f.source.code == "F-7"]
    assert f.quote == "150 मिली" and f.origins == ["rule", "ai"] and res.stats.merged == 1
