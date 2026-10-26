"""Sourcemark analysis service. Internal only: every request must carry the shared token, and only
the Express API holds it."""

from __future__ import annotations

import hmac
import logging
from functools import lru_cache
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile

from .config import get_settings
from .contract import (
    AnalyzeRequest,
    AnalyzeResponse,
    EmbedRequest,
    EmbedResponse,
    ExtractGuidelineResponse,
    ParseResponse,
    SuggestRulesRequest,
    SuggestRulesResponse,
)
from .llm import LLM, GeminiLLM, LLMError
from .parsing import MAX_BYTES, ParseError, extract_clauses, extract_text
from .pipeline import analyze
from .retrieval import PgVectorRetriever, Retriever
from .suggest import suggest_rules

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

app = FastAPI(title="Sourcemark analysis", docs_url=None, redoc_url=None, openapi_url=None)


@lru_cache
def get_llm() -> LLM | None:
    settings = get_settings()
    return GeminiLLM(settings) if settings.gemini_api_key else None


@lru_cache
def get_retriever() -> Retriever | None:
    settings = get_settings()
    return PgVectorRetriever(settings.database_url) if settings.database_url else None


def require_token(x_internal_token: Annotated[str | None, Header()] = None) -> None:
    expected = get_settings().internal_token
    if not x_internal_token or not hmac.compare_digest(x_internal_token.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Invalid internal token")


Auth = Depends(require_token)


async def _read_upload(file: UploadFile) -> bytes:
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="The file is too large")
    return data


@app.get("/health")
def health() -> dict:
    return {"ok": True, "ai": get_llm() is not None, "retrieval": get_retriever() is not None}


@app.post("/analyze", response_model=AnalyzeResponse, dependencies=[Auth])
def analyze_endpoint(req: AnalyzeRequest) -> AnalyzeResponse:
    return analyze(req, get_llm(), get_retriever(), get_settings())


@app.post("/parse", response_model=ParseResponse, dependencies=[Auth])
async def parse_endpoint(file: UploadFile = File(...)) -> ParseResponse:
    data = await _read_upload(file)
    try:
        text, fmt, warnings = extract_text(file.filename or "", data)
    except ParseError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return ParseResponse(text=text, format=fmt, warnings=warnings)  # type: ignore[arg-type]


@app.post("/guidelines/extract", response_model=ExtractGuidelineResponse, dependencies=[Auth])
async def extract_endpoint(
    prefix: Annotated[str, Form(pattern=r"^G\d*$")],
    file: UploadFile | None = File(None),
    text: Annotated[str | None, Form()] = None,
) -> ExtractGuidelineResponse:
    warnings: list[str] = []
    if file is not None:
        try:
            text, _, warnings = extract_text(file.filename or "", await _read_upload(file))
        except ParseError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e
    if not text or not text.strip():
        raise HTTPException(status_code=422, detail="Provide a file or text")
    clauses, more = extract_clauses(text, prefix)
    return ExtractGuidelineResponse(clauses=clauses, warnings=warnings + more)


@app.post("/embed", response_model=EmbedResponse, dependencies=[Auth])
def embed_endpoint(req: EmbedRequest) -> EmbedResponse:
    llm = get_llm()
    if llm is None:
        raise HTTPException(status_code=503, detail="Embeddings are not configured (GEMINI_API_KEY is not set)")
    try:
        vectors = llm.embed(req.texts, req.task)
    except LLMError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return EmbedResponse(model=llm.embedding_model, dim=len(vectors[0]) if vectors else 0, vectors=vectors)


@app.post("/rules/suggest", response_model=SuggestRulesResponse, dependencies=[Auth])
def suggest_endpoint(req: SuggestRulesRequest) -> SuggestRulesResponse:
    llm = get_llm()
    if llm is None:
        raise HTTPException(status_code=503, detail="Rule suggestions need GEMINI_API_KEY")
    try:
        return SuggestRulesResponse(suggestions=suggest_rules(req.clauses, llm))
    except LLMError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
