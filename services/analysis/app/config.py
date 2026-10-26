from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Settings:
    internal_token: str
    database_url: str | None
    gemini_api_key: str | None
    gemini_model: str
    embedding_model: str
    embedding_dim: int
    retrieval_top_k: int
    ai_min_confidence: float
    gemini_timeout_s: float
    gemini_max_retries: int


@lru_cache
def get_settings() -> Settings:
    token = os.environ.get("INTERNAL_TOKEN", "")
    if len(token) < 16:
        raise RuntimeError("INTERNAL_TOKEN must be set (at least 16 characters) and match ANALYSIS_TOKEN in the API")
    return Settings(
        internal_token=token,
        database_url=os.environ.get("DATABASE_URL") or None,
        gemini_api_key=os.environ.get("GEMINI_API_KEY") or None,
        gemini_model=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
        embedding_model=os.environ.get("EMBEDDING_MODEL", "gemini-embedding-001"),
        embedding_dim=int(os.environ.get("EMBEDDING_DIM", "768")),
        retrieval_top_k=int(os.environ.get("RETRIEVAL_TOP_K", "8")),
        ai_min_confidence=float(os.environ.get("AI_MIN_CONFIDENCE", "0.5")),
        gemini_timeout_s=float(os.environ.get("GEMINI_TIMEOUT_S", "45")),
        gemini_max_retries=int(os.environ.get("GEMINI_MAX_RETRIES", "3")),
    )
