-- AlterTable: add memory_type and session_shared to memories
-- memory_type distinguishes distilled (LLM-extracted summaries) from neuralese
-- (raw reasoning segment embeddings). Defaults to 'distilled' for all existing rows.
-- session_shared enables retrieval across sessions for the same user/org.

ALTER TABLE "memories"
  ADD COLUMN "memory_type"    VARCHAR(50) NOT NULL DEFAULT 'distilled',
  ADD COLUMN "session_shared" BOOLEAN     NOT NULL DEFAULT false;
