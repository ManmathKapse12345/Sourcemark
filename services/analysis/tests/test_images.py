"""Image review: brand colours, logo use, text contrast, alt text, and the text in the image."""

from __future__ import annotations

import base64
import io
import json

import jsonschema
import pytest
from conftest import REPO, FakeLLM
from fastapi.testclient import TestClient
from PIL import Image

from app.contract import ImageAnalyzeRequest, ImageAsset
from app.images import (
    ImageError,
    analyze_image,
    contrast_ratio,
    delta_e2000,
    load_image,
    logo_findings,
)
from app.main import app

IMAGES = REPO / "eval" / "images"
SCHEMAS = REPO / "packages" / "contract" / "schema"
LOGO = base64.b64encode((IMAGES / "northfern-logo.png").read_bytes()).decode()
ASSETS = [
    ImageAsset(code="A-1", name="Northfern palette", type="palette", colors=["#1F4D3A", "#F4EFE6", "#C9A66B", "#2B2B2B"]),
    ImageAsset(code="A-2", name="Northfern logo", type="logo", colors=[], image_b64=LOGO),
]
ALT = "Calm Barrier Moisturiser poster with the Northfern logo."


def request(kit, alt_text=ALT, channel="instagram", ai=False, assets=ASSETS):
    return ImageAnalyzeRequest(org_id="org_test", channel=channel, alt_text=alt_text, brand_kit=kit, assets=assets,
                               options={"ai": ai, "as_of": "2026-10-26"})


def post(name):
    return (IMAGES / f"{name}.png").read_bytes()


def checks(res):
    return sorted((f.source.code, f.quote) for f in res.findings)


def test_colour_science_matches_reference_values():
    # Sharma, Wu and Dalal (2005), CIEDE2000 test pair 1.
    assert delta_e2000((50, 2.6772, -79.7751), (50, 0, -82.7485)) == pytest.approx(2.0425, abs=1e-4)
    assert contrast_ratio((0, 0, 0), (255, 255, 255)) == pytest.approx(21.0)
    assert contrast_ratio((0x77, 0x77, 0x77), (255, 255, 255)) == pytest.approx(4.48, abs=0.01)


def test_brand_colours_pass_and_off_palette_colours_are_cited_and_located(kit, settings):
    assert checks(analyze_image(request(kit), post("i01"), None, None, settings)) == []
    res = analyze_image(request(kit), post("i03"), None, None, settings)
    [f] = res.findings
    assert f.source.type == "asset" and f.source.code == "A-1" and "#1F4D3A" in f.source.text
    assert f.category == "visual" and "is not a brand colour" in f.explanation
    assert f.box.y == pytest.approx(600 / 1080, abs=0.02) and f.box.h == pytest.approx(220 / 1080, abs=0.02)
    # White and black are neutral: allowed with any palette.
    assert checks(analyze_image(request(kit, alt_text="Gentle Oat Cleanser."), post("i14"), None, None, settings)) == []


@pytest.mark.parametrize("name,problem", [("i08", "stretched"), ("i09", "rotated"), ("i10", "recoloured")])
def test_logo_misuse(name, problem):
    img, _ = load_image(post(name))
    [f] = logo_findings(img, ASSETS)[0]
    assert f.quote == f"Northfern logo ({problem})" and f.source.code == "A-2" and f.box is not None


def test_an_approved_logo_next_to_text_in_the_same_typeface_is_not_flagged():
    # The headline shares letters with the word mark; stray matches must not bend the fit.
    for name in ("i01", "i04", "i06", "i13"):
        img, _ = load_image(post(name))
        assert logo_findings(img, ASSETS)[0] == [], name


def test_alt_text_is_required_except_in_print(kit, settings):
    res = analyze_image(request(kit, alt_text=""), post("i11"), None, None, settings)
    assert checks(res) == [("WCAG-1.1.1", "")]
    assert checks(analyze_image(request(kit, alt_text=None, channel="print"), post("i11"), None, None, settings)) == []


def test_text_in_the_image_goes_through_the_text_pipeline_and_gets_a_box(kit, settings):
    llm = FakeLLM({"TextBlocks": {"blocks": [
        {"text": "Calm Barrier Moisturiser", "box_2d": [120, 70, 200, 700]},
        {"text": "Now just ₹499", "box_2d": [210, 70, 300, 520]},
    ]}})
    res = analyze_image(request(kit, ai=True), post("i06"), llm, None, settings)
    assert res.ocr_text == "Calm Barrier Moisturiser Now just ₹499" and llm.images == [("image/png", llm.images[0][1])]
    [price] = [f for f in res.findings if f.source and f.source.code == "F-2"]
    assert price.quote == "₹499" and price.fix.replacement == "₹549"
    assert price.box.y == pytest.approx(0.21) and price.box.h == pytest.approx(0.09)
    assert res.rewrites == [] and res.ai_status == "ok"


def test_low_contrast_text_is_measured_on_the_image(kit, settings):
    # "Gentle on dry skin" is gold (#C9A66B) on cream (#F4EFE6): about 2:1.
    llm = FakeLLM({"TextBlocks": {"blocks": [
        {"text": "Calm Barrier Moisturiser", "box_2d": [125, 70, 200, 720]},
        {"text": "Gentle on dry skin", "box_2d": [215, 70, 265, 460]},
    ]}})
    res = analyze_image(request(kit, ai=True), post("i05"), llm, None, settings)
    [f] = [f for f in res.findings if f.source and f.source.code == "WCAG-1.4.3"]
    assert f.quote == "Gentle on dry skin" and "contrast ratio of 2." in f.explanation


def test_without_ai_the_measurable_checks_still_run_and_say_what_was_skipped(kit, settings):
    res = analyze_image(request(kit, alt_text=""), post("i15"), None, None, settings)
    assert {f.source.code for f in res.findings} == {"A-1", "WCAG-1.1.1"}
    assert res.ai_status == "disabled" and any("AI checks are off" in n for n in res.notes)
    res = analyze_image(request(kit, assets=[]), post("i01"), None, None, settings)
    assert any("no palette" in n for n in res.notes) and any("no logo file" in n for n in res.notes)


def test_rejects_files_that_are_not_images():
    with pytest.raises(ImageError):
        load_image(b"%PDF-1.4 not an image")
    buf = io.BytesIO()
    Image.new("RGB", (10, 10)).save(buf, format="GIF")
    with pytest.raises(ImageError):
        load_image(buf.getvalue())


def test_endpoint_matches_the_exported_schema(kit):
    client = TestClient(app)
    auth = {"X-Internal-Token": "test-internal-token-123"}
    body = request(kit, alt_text="").model_dump_json()
    jsonschema.validate(json.loads(body), json.loads((SCHEMAS / "ImageAnalyzeRequest.json").read_text(encoding="utf-8")))
    res = client.post("/images/analyze", data={"request": body}, files={"file": ("p.png", post("i15"), "image/png")}, headers=auth)
    assert res.status_code == 200
    jsonschema.validate(res.json(), json.loads((SCHEMAS / "ImageAnalyzeResponse.json").read_text(encoding="utf-8")))
    bad = client.post("/images/analyze", data={"request": body}, files={"file": ("p.png", b"nope", "image/png")}, headers=auth)
    assert bad.status_code == 422


def test_text_that_is_part_of_a_logo_has_no_contrast_requirement(kit, settings):
    # WCAG 1.4.3 exempts logotypes: the recoloured word mark is a logo problem, not a contrast one.
    llm = FakeLLM({"TextBlocks": {"blocks": [
        {"text": "Calm Barrier Moisturiser", "box_2d": [125, 70, 200, 720]},
        {"text": "Northfern", "box_2d": [820, 200, 900, 400]},
    ]}})
    res = analyze_image(request(kit, ai=True), post("i10"), llm, None, settings)
    assert [f.source.code for f in res.findings if f.source and f.source.type in ("asset", "standard")] == ["A-2"]
