-- Approximate nearest-neighbour index for clause retrieval (cosine distance, used by the analysis service).
CREATE INDEX IF NOT EXISTS "Clause_embedding_hnsw" ON "Clause" USING hnsw ("embedding" vector_cosine_ops);
