/**
 * Memory decay / TTL pruning job.
 *
 * Soft-deactivates stale LOW-importance memories — those not accessed (or, if
 * never accessed, not created) within the TTL window. High/critical memories are
 * never pruned; medium uses a longer TTL. Run on a schedule (e.g. a K8s CronJob):
 *
 *   npm run prune:memories
 *
 * Tunable via env:
 *   MEMORY_TTL_LOW_DAYS     (default 90)   — low-importance inactivity window
 *   MEMORY_TTL_MEDIUM_DAYS  (default 180)  — medium-importance inactivity window
 *   MEMORY_PRUNE_DRY_RUN    (default false) — when "true", report counts without deactivating
 */
// Load .env before the Prisma client module reads DATABASE_URL (Prisma 7 no longer loads it).
import "dotenv/config";
import prisma from "../services/prisma.service";
import { logger } from "../lib/logger";

const DAY_MS = 86_400_000;

async function pruneTier(
  importance: "low" | "medium",
  ttlDays: number,
  dryRun: boolean,
): Promise<number> {
  const cutoff = new Date(Date.now() - ttlDays * DAY_MS);
  const where = {
    isActive: true,
    importance,
    OR: [
      { lastAccessedAt: { lt: cutoff } },
      { lastAccessedAt: null, createdAt: { lt: cutoff } },
    ],
  };

  if (dryRun) {
    return prisma.memory.count({ where });
  }
  const { count } = await prisma.memory.updateMany({
    where,
    data: { isActive: false },
  });
  return count;
}

async function main(): Promise<void> {
  const dryRun = process.env.MEMORY_PRUNE_DRY_RUN === "true";
  const lowDays = parseInt(process.env.MEMORY_TTL_LOW_DAYS || "90", 10);
  const mediumDays = parseInt(process.env.MEMORY_TTL_MEDIUM_DAYS || "180", 10);

  const started = Date.now();
  const low = await pruneTier("low", lowDays, dryRun);
  const medium = await pruneTier("medium", mediumDays, dryRun);

  logger.info(
    {
      dry_run: dryRun,
      low_pruned: low,
      medium_pruned: medium,
      ttl_low_days: lowDays,
      ttl_medium_days: mediumDays,
      duration_ms: Date.now() - started,
      status: "success",
    },
    dryRun
      ? "Memory prune (dry-run): counts only"
      : "Memory prune: deactivated stale memories",
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      "Memory prune failed",
    );
    await prisma.$disconnect();
    process.exit(1);
  });
