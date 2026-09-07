-- Manual migration: remove fixed-dimension constraint from embedding column
-- Switching from vector(1024) to a dimensionless vector column so that future
-- embedding model changes (e.g. nomic-embed-text 768d, all-minilm 384d) only
-- require re-embedding memories, not a schema migration.
--
-- Note: dimensionless vector columns use sequential scan instead of HNSW/IVFFlat
-- index. This is acceptable for small memory stores (Jetson Nano use case).
--
-- After applying this migration, re-embed all existing memories:
--   OLLAMA_URL=... EMBEDDING_MODEL=nomic-embed-text npm run migrate:re-embed
ALTER TABLE memories DROP COLUMN IF EXISTS embedding;
ALTER TABLE memories ADD COLUMN embedding vector;
