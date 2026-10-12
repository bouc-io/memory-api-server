-- Fix vector dimension mismatch
-- Changes embedding column from vector(1536) to vector(384)
-- This aligns the database with the Xenova/all-MiniLM-L6-v2 model (384 dimensions)

-- AlterTable
-- Note: This will drop existing embeddings if any have incompatible dimensions
-- The application will regenerate embeddings on the next memory access
ALTER TABLE "memories" ALTER COLUMN "embedding" TYPE vector(384);

-- Rollback instructions (manual):
-- ALTER TABLE "memories" ALTER COLUMN "embedding" TYPE vector(1536);
