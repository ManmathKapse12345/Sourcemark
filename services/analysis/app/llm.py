"""Gemini access behind a small interface, so tests and the evaluation can swap in fakes."""

from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Literal, Protocol, TypeVar

import numpy as np
from pydantic import BaseModel, ValidationError

from .config import Settings

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)
RETRYABLE = {408, 429, 500, 502, 503, 504}


class LLMError(RuntimeError):
    """The model could not produce a usable answer. Callers fall back to rule checks only."""


_deadline: ContextVar[float | None] = ContextVar("llm_deadline", default=None)


@contextmanager
def time_budget(seconds: float) -> Iterator[None]:
    """Model calls made inside stop retrying, and new ones are refused, once the budget is spent, so a
    review under rate limiting falls back to rule checks instead of outlasting the API's timeout."""
    token = _deadline.set(time.monotonic() + seconds)
    try:
        yield
    finally:
        _deadline.reset(token)


def _check_budget(what: str, wait: float = 0.0) -> None:
    deadline = _deadline.get()
    if deadline is not None and time.monotonic() + wait >= deadline:
        raise LLMError(f"Gemini {what} skipped: the time budget for this review is used up")


class LLM(Protocol):
    model: str
    embedding_model: str

    def generate_json(self, system: str, prompt: str, schema: type[T]) -> T: ...

    def embed(self, texts: list[str], task: Literal["document", "query"]) -> list[list[float]]: ...


class GeminiLLM:
    def __init__(self, settings: Settings):
        from google import genai
        from google.genai import types

        self._types = types
        self.model = settings.gemini_model
        self.embedding_model = settings.embedding_model
        self.dim = settings.embedding_dim
        self.retries = max(1, settings.gemini_max_retries)
        self.client = genai.Client(
            api_key=settings.gemini_api_key,
            http_options=types.HttpOptions(timeout=int(settings.gemini_timeout_s * 1000)),
        )

    def _with_retries(self, what: str, fn):
        from google.genai import errors

        delay = 2.0
        for attempt in range(1, self.retries + 1):
            _check_budget(what)
            try:
                return fn()
            except errors.APIError as e:
                retryable = getattr(e, "code", None) in RETRYABLE
                log.warning("gemini %s failed (attempt %d, code %s): %s", what, attempt, getattr(e, "code", None), e)
                if not retryable or attempt == self.retries:
                    raise LLMError(f"Gemini {what} failed: {getattr(e, 'code', '')} {getattr(e, 'message', '') or e}".strip()) from e
            except ValidationError as e:
                log.warning("gemini %s returned invalid JSON (attempt %d): %s", what, attempt, e)
                if attempt == self.retries:
                    raise LLMError(f"Gemini {what} returned output that does not match the schema") from e
            except Exception as e:  # network errors, timeouts
                log.warning("gemini %s error (attempt %d): %s", what, attempt, e)
                if attempt == self.retries:
                    raise LLMError(f"Gemini {what} failed: {e}") from e
            _check_budget(what, delay)
            time.sleep(delay)
            delay *= 2

    def generate_json(self, system: str, prompt: str, schema: type[T]) -> T:
        types = self._types

        def call() -> T:
            resp = self.client.models.generate_content(
                model=self.model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    response_mime_type="application/json",
                    response_schema=schema,
                    temperature=0.0,
                ),
            )
            if not resp.text:
                raise RuntimeError("empty response (possibly blocked by safety filters)")
            return schema.model_validate_json(resp.text)

        return self._with_retries("generation", call)

    def embed(self, texts: list[str], task: Literal["document", "query"]) -> list[list[float]]:
        types = self._types
        task_type = "RETRIEVAL_DOCUMENT" if task == "document" else "RETRIEVAL_QUERY"
        vectors: list[list[float]] = []
        for i in range(0, len(texts), 100):
            batch = texts[i:i + 100]
            resp = self._with_retries("embedding", lambda: self.client.models.embed_content(
                model=self.embedding_model,
                contents=batch,
                config=types.EmbedContentConfig(task_type=task_type, output_dimensionality=self.dim),
            ))
            vectors.extend(_unit(e.values) for e in resp.embeddings)
        return vectors


def _unit(v) -> list[float]:
    # Truncated Gemini embeddings are not normalised; cosine distance assumes unit length.
    arr = np.asarray(v, dtype=np.float32)
    norm = float(np.linalg.norm(arr))
    return (arr / norm).tolist() if norm else arr.tolist()
