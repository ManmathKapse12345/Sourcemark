"""Finds the guideline clauses most relevant to a passage."""

from __future__ import annotations

import logging
from typing import Protocol

import numpy as np

log = logging.getLogger(__name__)


class Retriever(Protocol):
    def top_clauses(self, org_id: str, query: list[float], k: int) -> list[str]:
        """Clause codes, most relevant first. Empty when nothing is embedded."""
        ...


class PgVectorRetriever:
    """Reads embeddings written by the API when a guideline version is published.

    Read-only, and always filtered by organisation and by published versions.
    """

    def __init__(self, database_url: str):
        from psycopg_pool import ConnectionPool

        self.pool = ConnectionPool(database_url, min_size=0, max_size=4, open=False, kwargs={"autocommit": True})
        self.pool.open(wait=False)

    def top_clauses(self, org_id: str, query: list[float], k: int) -> list[str]:
        vector = "[" + ",".join(f"{x:.7f}" for x in query) + "]"
        with self.pool.connection() as conn:
            rows = conn.execute(
                """
                SELECT c."code"
                FROM "Clause" c
                JOIN "GuidelineVersion" v ON v."id" = c."versionId"
                WHERE c."orgId" = %s AND v."status" = 'PUBLISHED' AND c."embedding" IS NOT NULL
                ORDER BY c."embedding" <=> %s::vector
                LIMIT %s
                """,
                (org_id, vector, k),
            ).fetchall()
        return [r[0] for r in rows]


class InMemoryRetriever:
    """Cosine search over vectors held in memory. Used by the evaluation and tests."""

    def __init__(self, vectors: dict[str, list[float]]):
        self.codes = list(vectors)
        self.matrix = np.asarray([vectors[c] for c in self.codes], dtype=np.float32) if vectors else None

    def top_clauses(self, org_id: str, query: list[float], k: int) -> list[str]:
        if self.matrix is None:
            return []
        scores = self.matrix @ np.asarray(query, dtype=np.float32)
        return [self.codes[i] for i in np.argsort(-scores)[:k]]
