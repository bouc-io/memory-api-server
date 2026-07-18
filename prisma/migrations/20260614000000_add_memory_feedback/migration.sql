-- AlterTable: add user-feedback counters to memories.
-- helpful_count / unhelpful_count back the POST /v1/memories/:id/feedback endpoint,
-- which also adjusts importance (helpful → up a tier, unhelpful → down) and
-- deactivates memories marked "wrong". Defaults to 0 for all existing rows.

ALTER TABLE "memories"
  ADD COLUMN "helpful_count"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "unhelpful_count" INTEGER NOT NULL DEFAULT 0;
