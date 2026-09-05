-- Add model provenance columns for research/audit trail
-- embedding_model: which Ollama embedding model generated the vector for this memory
-- distillation_model: which LLM was used to extract/compress this memory (null for manually-created memories)
ALTER TABLE "memories" ADD COLUMN "embedding_model" TEXT;
ALTER TABLE "memories" ADD COLUMN "distillation_model" TEXT;
