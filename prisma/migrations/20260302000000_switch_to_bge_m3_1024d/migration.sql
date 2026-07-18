-- Switch embedding column from 384d (all-MiniLM-L6-v2) to 1024d (bge-m3)
-- Manual migration required: Prisma cannot auto-detect Unsupported() dimension changes
-- DROP + ADD is required instead of ALTER TYPE because pgvector cannot cast between dimensions
-- Existing embeddings are invalidated — run `npm run migrate:re-embed` after deployment

ALTER TABLE "memories" DROP COLUMN "embedding";
ALTER TABLE "memories" ADD COLUMN "embedding" vector(1024);
