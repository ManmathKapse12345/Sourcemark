from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

os.environ["INTERNAL_TOKEN"] = "test-internal-token-123"
os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("DATABASE_URL", None)

SERVICE = Path(__file__).resolve().parents[1]
REPO = SERVICE.parents[1]
sys.path.insert(0, str(SERVICE))

from app.config import Settings  # noqa: E402
from app.contract import AnalyzeRequest, BrandKit, ClauseDTO, FactDTO, RuleDTO  # noqa: E402
from app.llm import LLMError  # noqa: E402


@pytest.fixture(scope="session")
def kit() -> BrandKit:
    raw = json.loads((REPO / "eval" / "brand_kit.json").read_text(encoding="utf-8"))
    return BrandKit(
        rules=[RuleDTO(**r) for r in raw["rules"]],
        facts=[FactDTO(**f) for f in raw["facts"]],
        clauses=[ClauseDTO(**c) for c in raw["guideline"]["clauses"]],
    )


@pytest.fixture
def settings() -> Settings:
    return Settings(
        internal_token="test-internal-token-123", database_url=None, gemini_api_key=None,
        gemini_model="fake-model", embedding_model="fake-embed", embedding_dim=4, retrieval_top_k=8,
        ai_min_confidence=0.5, gemini_timeout_s=5, gemini_max_retries=1,
    )


def make_request(kit: BrandKit, text: str, channel: str = "instagram", ai: bool = False) -> AnalyzeRequest:
    return AnalyzeRequest(org_id="org_test", content={"text": text, "channel": channel}, brand_kit=kit,
                          options={"ai": ai, "as_of": "2026-10-26"})


class FakeLLM:
    """Returns scripted model output per schema, and records prompts."""

    model = "fake-model"
    embedding_model = "fake-embed"
    dim = 4

    def __init__(self, responses: dict[str, object] | None = None, fail: bool = False):
        self.responses = responses or {}
        self.fail = fail
        self.prompts: list[tuple[str, str]] = []

    def generate_json(self, system, prompt, schema):
        self.prompts.append((system, prompt))
        if self.fail:
            raise LLMError("Gemini generation failed: 503 overloaded")
        data = self.responses.get(schema.__name__, {"issues": [], "rewrites": [], "suggestions": []})
        return schema.model_validate(data)

    def embed(self, texts, task):
        return [[1.0, 0.0, 0.0, 0.0] for _ in texts]
