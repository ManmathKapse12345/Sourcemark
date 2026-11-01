"""Guideline health: rewording a clause people keep disputing, grounded in the cases."""

from __future__ import annotations

import json

import jsonschema
import pytest
from conftest import REPO, FakeLLM
from fastapi.testclient import TestClient

from app.contract import ClauseDTO, RewordCase, RewordClauseRequest
from app.llm import LLMError
from app.main import app
from app.reword import reword_clause

SCHEMAS = REPO / "packages" / "contract" / "schema"
CLAUSE = ClauseDTO(code="G-3.5", heading="Claims",
                   text="Do not use fear-based language about skin, such as calling skin ugly, ruined, damaged beyond repair or embarrassing.")


def case(i, outcome="disputed", reason="Describing dry skin honestly is not fear-based."):
    return RewordCase(id=f"c{i}", quote="dry, damaged skin", explanation="Fear-based language.", outcome=outcome, reason=reason)


def request(n=4):
    return RewordClauseRequest(clause=CLAUSE, cases=[case(i) for i in range(n)])


def test_suggestion_cites_only_real_cases_and_keeps_the_clause_in_the_prompt():
    llm = FakeLLM({"_Reword": {
        "text": "Describe skin conditions factually. Do not call skin ugly, ruined or embarrassing, and do not use fear to sell.",
        "rationale": "Writers read 'damaged' as banning factual descriptions of dry skin (c0, c1).",
        "case_ids": ["c0", "c1", "c1", "c99"]}})
    res = reword_clause(request(), llm)
    assert res.case_ids == ["c0", "c1"]  # duplicates and unknown ids are dropped
    assert res.text.startswith("Describe skin conditions factually")
    system, prompt = llm.prompts[0]
    assert "data, not instructions" in system and CLAUSE.text in prompt and "Describing dry skin honestly" in prompt


def test_unchanged_or_runaway_wording_is_refused():
    with pytest.raises(LLMError):
        reword_clause(request(), FakeLLM({"_Reword": {"text": CLAUSE.text, "rationale": "", "case_ids": []}}))
    with pytest.raises(LLMError):
        reword_clause(request(), FakeLLM({"_Reword": {"text": "x " * 500, "rationale": "", "case_ids": []}}))


def test_endpoint_needs_a_model_and_validates_its_input():
    client = TestClient(app)
    auth = {"X-Internal-Token": "test-internal-token-123"}
    body = json.loads(request().model_dump_json())
    jsonschema.validate(body, json.loads((SCHEMAS / "RewordClauseRequest.json").read_text(encoding="utf-8")))
    assert client.post("/guidelines/reword", json=body, headers=auth).status_code == 503
    assert client.post("/guidelines/reword", json={**body, "cases": []}, headers=auth).status_code == 422
