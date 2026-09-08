-- Omni Agent Brain vector retrieval schema v1
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS omni_brain_vectors (
  memory_id TEXT PRIMARY KEY,
  embedding vector(256) NOT NULL,
  memory JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS omni_brain_vectors_embedding_hnsw_idx
  ON omni_brain_vectors USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS omni_brain_vectors_updated_at_idx
  ON omni_brain_vectors (updated_at);
