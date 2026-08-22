import { Request, Response } from 'express';
import prisma from '../services/prisma.service';
import { VectorService } from '../services/vector.service';
import { Prisma } from '@prisma/client';
import { createComponentLogger } from '../lib/logger';

const logger = createComponentLogger('assignment-controller');

const HIGH_SEMANTIC_THRESHOLD = 0.85;

/** Relative weight by importance for composite ranking of the fill tier. */
const IMPORTANCE_WEIGHT: Record<string, number> = { critical: 1.0, high: 0.9, medium: 0.7, low: 0.5 };
/** Recency half-life in days — a memory's recency factor halves every N days. */
const RECENCY_HALFLIFE_DAYS = parseFloat(process.env.MEMORY_RECENCY_HALFLIFE_DAYS || '30');

/**
 * Composite relevance score = semantic similarity × importance weight × recency decay.
 * Recency decays with the memory's AGE (createdAt) — deliberately not lastAccessedAt,
 * which retrieval bumps to "now" and would collapse the signal into a rich-get-richer loop.
 */
function compositeScore(confidence: number, importance: string, createdAt: Date): number {
    const weight = IMPORTANCE_WEIGHT[importance] ?? 0.6;
    const ageDays = Math.max(0, (Date.now() - new Date(createdAt).getTime()) / 86_400_000);
    const recency = Math.pow(0.5, ageDays / RECENCY_HALFLIFE_DAYS);
    return confidence * weight * recency;
}

export class AssignmentController {
    static async updateSettings(req: Request, res: Response) {
        res.status(501).json({ error: 'Not Implemented' });
    }

    /**
     * POST /v1/assignments/:id/memories/retrieve
     *
     * Tiered hybrid retrieval:
     *   Tier 1 — Critical: ALL critical-importance memories, always included
     *   Tier 2 — High semantic: high-importance memories above a strict 0.85 threshold
     *   Tier 3 — Fill: medium/low memories filling remaining slots
     *
     * Body: { query?: string, limit?: number }
     */
    static async retrieveMemories(req: Request, res: Response) {
        const startTime = Date.now();
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const orgId = req.user?.orgId ?? null;
        const orgFilter = orgId
            ? Prisma.sql`AND org_id = ${orgId}`
            : Prisma.sql``;

        try {
            const { query = '', limit: rawLimit = 10 } = req.body;
            const limit = Math.min(Number(rawLimit), 50);

            // ── Tier 1: always fetch ALL critical memories ──────────────────────
            const criticalRows = await prisma.memory.findMany({
                where: {
                    userId,
                    importance: 'critical',
                    isActive: true,
                    ...(orgId && { orgId }),
                },
            });
            const criticalMemories = criticalRows.map(m => ({
                id: m.id,
                content: m.content,
                category: m.category as string,
                importance: m.importance as string,
                confidence: 1.0,
            }));

            const remaining = Math.max(0, limit - criticalMemories.length);
            let highMemories: Array<{ id: string; content: string; category: string; importance: string; confidence: number }> = [];
            let fillMemories: Array<{ id: string; content: string; category: string; importance: string; confidence: number }> = [];

            if (remaining > 0 && query) {
                const embedding = await VectorService.generateEmbedding(query);
                const vectorString = `[${embedding.join(',')}]`;
                const criticalIds: string[] = criticalRows.map(m => m.id);
                const tier2Limit = remaining;

                // ── Tier 2: high importance with strict semantic threshold ────────
                highMemories = await prisma.$queryRaw<typeof highMemories>(Prisma.sql`
                    SELECT id::text, content, category::text, importance::text,
                           (1 - (embedding <=> ${vectorString}::vector))::float8 as confidence
                    FROM memories
                    WHERE user_id = ${userId}
                    ${orgFilter}
                    AND importance::text = 'high'
                    AND is_active = true
                    AND id::text != ALL(${criticalIds}::text[])
                    AND (1 - (embedding <=> ${vectorString}::vector)) > ${HIGH_SEMANTIC_THRESHOLD}
                    ORDER BY confidence DESC
                    LIMIT ${tier2Limit}
                `);

                // ── Tier 3: fill remaining with medium/low, composite-ranked ──────
                // Pull a larger candidate pool ordered by raw similarity, then
                // re-rank by similarity × importance weight × recency decay so a
                // slightly-less-similar but important/recent memory can win a slot.
                const fillSlots = remaining - highMemories.length;
                if (fillSlots > 0) {
                    const usedIds: string[] = [
                        ...criticalIds,
                        ...highMemories.map(m => m.id),
                    ];
                    const candidatePool = Math.min(fillSlots * 4, 40);
                    type FillRow = { id: string; content: string; category: string; importance: string; confidence: number; created_at: Date; last_accessed_at: Date | null };
                    const candidates = await prisma.$queryRaw<FillRow[]>(Prisma.sql`
                        SELECT id::text, content, category::text, importance::text,
                               (1 - (embedding <=> ${vectorString}::vector))::float8 as confidence,
                               created_at, last_accessed_at
                        FROM memories
                        WHERE user_id = ${userId}
                        ${orgFilter}
                        AND importance::text IN ('medium', 'low')
                        AND is_active = true
                        AND id::text != ALL(${usedIds}::text[])
                        ORDER BY confidence DESC
                        LIMIT ${candidatePool}
                    `);
                    fillMemories = candidates
                        .map(c => ({ ...c, score: compositeScore(c.confidence, c.importance, c.created_at) }))
                        .sort((a, b) => b.score - a.score)
                        .slice(0, fillSlots)
                        .map(({ id, content, category, importance, confidence }) => ({ id, content, category, importance, confidence }));
                }
            }

            const allMemories = [...criticalMemories, ...highMemories, ...fillMemories];

            // Access tracking: record that these memories were retrieved. Non-blocking
            // semantics — a failure here must not fail the retrieval response.
            const accessedIds = allMemories.map(m => m.id);
            if (accessedIds.length > 0) {
                try {
                    await prisma.memory.updateMany({
                        where: { id: { in: accessedIds } },
                        data: { accessCount: { increment: 1 }, lastAccessedAt: new Date() },
                    });
                } catch (accErr) {
                    logger.warn({ error: accErr instanceof Error ? accErr.message : String(accErr) }, 'Access tracking update failed (non-fatal)');
                }
            }

            logger.info({
                user_id: userId,
                duration_ms: Date.now() - startTime,
                status: 'success',
                metrics: {
                    critical: criticalMemories.length,
                    high: highMemories.length,
                    fill: fillMemories.length,
                    total: allMemories.length,
                },
            }, 'Memories retrieved');

            res.json({
                memories: allMemories,
                total: allMemories.length,
                breakdown: {
                    critical: criticalMemories.length,
                    high: highMemories.length,
                    fill: fillMemories.length,
                },
            });

        } catch (error) {
            logger.error({
                error: error instanceof Error ? error.message : String(error),
                operation: 'retrieve-memories',
                user_id: userId,
            }, 'Error retrieving memories');
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}
