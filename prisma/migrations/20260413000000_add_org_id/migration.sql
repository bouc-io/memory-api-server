-- Add org_id to Memory
ALTER TABLE "memories" ADD COLUMN "org_id" TEXT;

-- Composite index for org-scoped queries
CREATE INDEX "memories_org_id_user_id_idx" ON "memories"("org_id", "user_id");

-- Backfill all existing memory records to the public org
UPDATE "memories" SET "org_id" = 'a0000000-0000-4000-8000-000000000002' WHERE "org_id" IS NULL;
