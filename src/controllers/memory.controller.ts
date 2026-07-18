import { Request, Response } from 'express';
import prisma from '../services/prisma.service';
import { VectorService, EMBEDDING_MODEL } from '../services/vector.service';
import { SUMMARIZATION_MODEL } from '../services/llm.service';
import { Prisma } from '@prisma/client';
import { createComponentLogger } from '../lib/logger';
import { findClusters, compressCluster } from '../services/summarization.service';

const logger = createComponentLogger('memory-controller');

/** Cosine similarity at/above which a new memory is treated as a duplicate of an existing one. */
const DEDUP_SIMILARITY_THRESHOLD = parseFloat(process.env.MEMORY_DEDUP_THRESHOLD || '0.92');

function extractBearer(req: Request): string | undefined {
    return req.headers.authorization?.split(' ')[1];
}

export class MemoryController {

    // GET /api/v1/memories/stats
    static async getStats(req: Request, res: Response) {
        try {
            const [total, active] = await Promise.all([
                prisma.memory.count({ where: { userId: req.user?.id } }),
                prisma.memory.count({ where: { isActive: true, userId: req.user?.id } })
            ]);

            const byCategory = await prisma.memory.groupBy({
                by: ['category'],
                where: { userId: req.user?.id },
                _count: { category: true }
            });

            const byImportance = await prisma.memory.groupBy({
                by: ['importance'],
                where: { userId: req.user?.id },
                _count: { importance: true }
            });

            const bySource = await prisma.memory.groupBy({
                by: ['source'],
                where: { userId: req.user?.id },
                _count: { source: true }
            });

            const stats = {
                total_memories: total,
                active_memories: active,
                inactive_memories: total - active,
                by_category: byCategory.reduce((acc, curr) => ({ ...acc, [curr.category]: curr._count.category }), {}),
                by_importance: byImportance.reduce((acc, curr) => ({ ...acc, [curr.importance]: curr._count.importance }), {}),
                by_source: bySource.reduce((acc, curr) => ({ ...acc, [curr.source]: curr._count.source }), {}),
            };

            res.json(stats);
        } catch (error) {
            logger.error(
                {
                    error: error instanceof Error ? error.message : String(error),
                    operation: 'get-stats',
                    user_id: req.user?.id,
                },
                'Error getting stats'
            );
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    // GET /api/v1/memories
    static async listMemories(req: Request, res: Response) {
        try {
            const { category, importance, tags, search, source, limit = 50, offset = 0 } = req.query;

            const where: Prisma.MemoryWhereInput = {
                userId: req.user?.id,
                ...(req.user?.orgId && { orgId: req.user.orgId }),
            };

            if (category) where.category = category as any;
            if (importance) where.importance = importance as any;
            if (source) where.source = source as any;
            if (tags) {
                where.tags = {
                    some: {
                        tag: { in: (tags as string).split(',') }
                    }
                };
            }
            if (search) {
                where.content = { contains: search as string, mode: 'insensitive' };
            }

            const memories = await prisma.memory.findMany({
                where,
                take: Number(limit),
                skip: Number(offset),
                orderBy: { updatedAt: 'desc' },
                include: { tags: true }
            });

            const total = await prisma.memory.count({ where });

            res.json({
                data: memories.map(m => ({
                    memory_id: m.id,
                    content: m.content,
                    category: m.category,
                    importance: m.importance,
                    tags: m.tags.map(t => t.tag),
                    created_at: m.createdAt,
                    updated_at: m.updatedAt,
                    access_count: m.accessCount,
                    last_accessed_at: m.lastAccessedAt,
                    source: m.source,
                    embedding_model: m.embeddingModel,
                    distillation_model: m.distillationModel
                })),
                pagination: {
                    limit: Number(limit),
                    offset: Number(offset),
                    total
                }
            });
        } catch (error) {
            logger.error(
                {
                    error: error instanceof Error ? error.message : String(error),
                    operation: 'list-memories',
                    user_id: req.user?.id,
                },
                'Error listing memories'
            );
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    // GET /api/v1/memories/:id
    static async getMemory(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const memory = await prisma.memory.findUnique({
                where: { id, userId: req.user?.id },
                include: { tags: true }
            });

            if (!memory) {
                res.status(404).json({ error: 'Memory not found' });
                return;
            }

            res.json({
                memory_id: memory.id,
                content: memory.content,
                category: memory.category,
                importance: memory.importance,
                tags: memory.tags.map(t => t.tag),
                created_at: memory.createdAt,
                updated_at: memory.updatedAt,
                access_count: memory.accessCount,
                last_accessed_at: memory.lastAccessedAt,
                source: memory.source,
                is_active: memory.isActive,
                metadata: memory.metadata,
                embedding_model: memory.embeddingModel,
                distillation_model: memory.distillationModel
            });
        } catch (error) {
            logger.error(
                {
                    error: error instanceof Error ? error.message : String(error),
                    operation: 'get-memory',
                    user_id: req.user?.id,
                },
                'Error getting memory'
            );
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    // POST /api/v1/memories
    static async createMemory(req: Request, res: Response) {
        try {
            const { content, category, importance, tags, metadata, distillation_model, source, memory_type, session_shared } = req.body;
            const userId = req.user?.id;

            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            if (!VectorService.isReady()) {
                res.status(503).json({
                    error: 'Embedding service unavailable',
                    reason: 'Ollama is not reachable. Read operations are available; try again later.',
                });
                return;
            }

            const embedding = await VectorService.generateEmbedding(content, extractBearer(req));
            const vectorString = `[${embedding.join(',')}]`;

            // Write-time semantic dedup: if an active same-category memory already
            // exists at/above the similarity threshold, return it instead of creating
            // a near-duplicate. Prevents the store from accumulating redundant rows.
            if (category) {
                const dupRows = await prisma.$queryRaw<Array<{ id: string; content: string; similarity: number }>>`
                    SELECT id::text, content,
                           (1 - (embedding <=> ${vectorString}::vector))::float8 AS similarity
                    FROM memories
                    WHERE user_id = ${userId} AND is_active = true AND embedding IS NOT NULL
                      AND category::text = ${category}
                    ORDER BY embedding <=> ${vectorString}::vector
                    LIMIT 1`;
                if (dupRows.length > 0 && dupRows[0].similarity >= DEDUP_SIMILARITY_THRESHOLD) {
                    logger.info(
                        { user_id: userId, existing_id: dupRows[0].id, similarity: dupRows[0].similarity },
                        'Memory dedup: near-duplicate detected — returning existing memory'
                    );
                    res.status(200).json({
                        memory_id: dupRows[0].id,
                        deduplicated: true,
                        similarity: dupRows[0].similarity,
                        content: dupRows[0].content,
                    });
                    return;
                }
            }

            // pgvector writes require raw SQL (Prisma can't write Unsupported("vector")).
            const memory = await prisma.memory.create({
                data: {
                    content,
                    category,
                    importance,
                    source: source || 'manual',
                    userId,
                    orgId: req.user?.orgId ?? null,
                    metadata: metadata || {},
                    embeddingModel: EMBEDDING_MODEL,
                    distillationModel: distillation_model || null,
                    memoryType: memory_type || 'distilled',
                    sessionShared: session_shared === true || session_shared === 'true',
                    tags: {
                        create: tags?.map((t: string) => ({ tag: t })) || []
                    }
                },
                include: { tags: true }
            });

            await prisma.$executeRaw`UPDATE memories SET embedding = ${vectorString}::vector WHERE id = ${memory.id}::uuid`;

            res.status(201).json({
                memory_id: memory.id,
                content: memory.content,
                category: memory.category,
                importance: memory.importance,
                tags: memory.tags.map(t => t.tag),
                created_at: memory.createdAt,
                updated_at: memory.updatedAt,
                access_count: memory.accessCount,
                last_accessed_at: memory.lastAccessedAt,
                source: memory.source,
                embedding_model: memory.embeddingModel,
                distillation_model: memory.distillationModel
            });

        } catch (error) {
            logger.error(
                {
                    error: error instanceof Error ? error.message : String(error),
                    operation: 'create-memory',
                    user_id: req.user?.id,
                },
                'Error creating memory'
            );
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    // POST /v1/memories/:id/feedback
    // Records user feedback and adjusts the memory accordingly:
    //   helpful   → +1 helpful_count, importance bumped up one tier
    //   unhelpful → +1 unhelpful_count, importance bumped down one tier
    //   wrong     → +1 unhelpful_count, memory deactivated (soft-deleted)
    static async submitFeedback(req: Request, res: Response) {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }
            const { id } = req.params;
            const { rating } = req.body as { rating: 'helpful' | 'unhelpful' | 'wrong' };

            const memory = await prisma.memory.findFirst({ where: { id, userId } });
            if (!memory) {
                res.status(404).json({ error: 'Memory not found' });
                return;
            }

            const tiers = ['low', 'medium', 'high', 'critical'] as const;
            const bump = (current: string, delta: number): typeof tiers[number] => {
                const i = tiers.indexOf(current as typeof tiers[number]);
                const next = Math.min(tiers.length - 1, Math.max(0, (i < 0 ? 0 : i) + delta));
                return tiers[next];
            };

            const data: Prisma.MemoryUpdateInput =
                rating === 'helpful'
                    ? { helpfulCount: { increment: 1 }, importance: bump(memory.importance, +1) }
                    : rating === 'unhelpful'
                        ? { unhelpfulCount: { increment: 1 }, importance: bump(memory.importance, -1) }
                        : { unhelpfulCount: { increment: 1 }, isActive: false }; // 'wrong'

            const updated = await prisma.memory.update({ where: { id }, data });
            logger.info({ user_id: userId, memory_id: id, rating }, 'Memory feedback recorded');

            res.json({
                memory_id: updated.id,
                rating,
                importance: updated.importance,
                is_active: updated.isActive,
                helpful_count: updated.helpfulCount,
                unhelpful_count: updated.unhelpfulCount,
            });
        } catch (error) {
            logger.error(
                { error: error instanceof Error ? error.message : String(error), operation: 'memory-feedback', user_id: req.user?.id },
                'Error recording memory feedback'
            );
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    // PATCH /api/v1/memories/:id
    static async updateMemory(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { content, category, importance, tags, is_active } = req.body;

            if (content !== undefined && !VectorService.isReady()) {
                res.status(503).json({
                    error: 'Embedding service unavailable',
                    reason: 'Ollama is not reachable. Content updates require re-embedding; try again later.',
                });
                return;
            }

            const data: any = {};
            if (content !== undefined) data.content = content;
            if (category !== undefined) data.category = category;
            if (importance !== undefined) data.importance = importance;
            if (is_active !== undefined) data.isActive = is_active;

            // Tags handling - simple replacement strategy for MVP or add/remove logical? 
            // Design says: "tags": ["new", "tags"], usually implies replacement or append.
            // We will replace tags if provided.
            if (tags) {
                data.tags = {
                    deleteMany: {},
                    create: tags.map((t: string) => ({ tag: t }))
                };
            }

            const memory = await prisma.memory.update({
                where: { id, userId: req.user?.id },
                data,
                include: { tags: true }
            });

            if (content) {
                // Re-generate embedding if content changed
                const embedding = await VectorService.generateEmbedding(content, extractBearer(req));
                const vectorString = `[${embedding.join(',')}]`;
                await prisma.$executeRaw`UPDATE memories SET embedding = ${vectorString}::vector WHERE id = ${memory.id}::uuid`;
                // Capture updated record so the response reflects the new embeddingModel
                const refreshed = await prisma.memory.update({
                    where: { id: memory.id },
                    data: { embeddingModel: EMBEDDING_MODEL },
                    include: { tags: true },
                });
                Object.assign(memory, refreshed);
            }

            res.json({
                memory_id: memory.id,
                content: memory.content,
                category: memory.category,
                importance: memory.importance,
                tags: memory.tags.map(t => t.tag),
                created_at: memory.createdAt,
                updated_at: memory.updatedAt,
                access_count: memory.accessCount,
                last_accessed_at: memory.lastAccessedAt,
                source: memory.source,
                embedding_model: memory.embeddingModel,
                distillation_model: memory.distillationModel
            });

        } catch (error) {
            logger.error(
                {
                    error: error instanceof Error ? error.message : String(error),
                    operation: 'update-memory',
                    user_id: req.user?.id,
                },
                'Error updating memory'
            );
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    // DELETE /api/v1/memories/:id
    static async deleteMemory(req: Request, res: Response) {
        try {
            const { id } = req.params;

            await prisma.memory.delete({
                where: { id, userId: req.user?.id }
            });

            res.json({
                success: true,
                memory_id: id,
                deleted_at: new Date().toISOString()
            });
        } catch (error) {
            logger.error(
                {
                    error: error instanceof Error ? error.message : String(error),
                    operation: 'delete-memory',
                    user_id: req.user?.id,
                },
                'Error deleting memory'
            );
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    // POST /api/v1/memories/search
    static async searchMemories(req: Request, res: Response) {
        try {
            const { query, limit = 10, min_relevance = 0.7, filters } = req.body;

            if (!VectorService.isReady()) {
                res.status(503).json({
                    error: 'Embedding service unavailable',
                    reason: 'Ollama is not reachable. Semantic search requires embeddings; try again later.',
                });
                return;
            }

            const embedding = await VectorService.generateEmbedding(query, extractBearer(req));
            const vectorString = `[${embedding.join(',')}]`;

            // Construct filter clause
            // Note: Full complex filtering with raw query is tricky. 
            // For MVP, we'll implement basic semantic search ordering.

            const orgFilter = req.user?.orgId
                ? Prisma.sql`AND org_id = ${req.user.orgId}`
                : Prisma.sql``;

            const memories = await prisma.$queryRaw(Prisma.sql`
              SELECT id, content, category, memory_type, session_shared,
                     1 - (embedding <=> ${vectorString}::vector) as relevance_score
              FROM memories
              WHERE 1 - (embedding <=> ${vectorString}::vector) > ${Number(min_relevance)}
              AND user_id = ${req.user?.id}
              ${orgFilter}
              ORDER BY relevance_score DESC
              LIMIT ${Number(limit)};
            `);

            // If we need associated tags or proper typing, we might need to map or fetch IDs
            // For now returning the raw result structure as per design response

            res.json({
                results: (memories as any[]).map((m: any) => ({
                    memory_id: m.id,
                    content: m.content,
                    category: m.category,
                    memory_type: m.memory_type || 'distilled',
                    session_shared: m.session_shared || false,
                    relevance_score: m.relevance_score
                }))
            });

        } catch (error) {
            logger.error(
                {
                    error: error instanceof Error ? error.message : String(error),
                    operation: 'search-memories',
                    user_id: req.user?.id,
                },
                'Error searching memories'
            );
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    // POST /v1/memories/compress
    static async compressMemories(req: Request, res: Response) {
        const startTime = Date.now();
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (!VectorService.isReady()) {
            return res.status(503).json({
                error: 'Embedding service unavailable',
                reason: 'Ollama is not reachable. Memory compression requires embeddings; try again later.',
            });
        }

        try {
            const orgId = req.user?.orgId ?? null;
            const { min_cluster_size = 3, dry_run = false } = req.body;

            const { clusters } = await findClusters(userId, orgId, 0.90, Number(min_cluster_size));

            if (dry_run || clusters.length === 0) {
                return res.json({
                    clusters_found: clusters.length,
                    clusters_compressed: 0,
                    memories_deactivated: 0,
                    dry_run: true,
                    preview: clusters.map(c => ({
                        size: c.length,
                        samples: c.slice(0, 2).map(m => m.content.slice(0, 100)),
                    })),
                });
            }

            let clustersCompressed = 0;
            let memoriesDeactivated = 0;

            for (const cluster of clusters) {
                const extraction = await prisma.memoryExtraction.create({
                    data: {
                        status: 'processing',
                        extractedCount: cluster.length,
                        savedCount: 0,
                        metadata: { source: 'compression', user_id: userId },
                    },
                });

                try {
                    const compressed = await compressCluster(cluster);

                    // Create merged memory
                    const newMemory = await prisma.memory.create({
                        data: {
                            userId,
                            orgId,
                            content: compressed.content,
                            category: compressed.category,
                            importance: compressed.importance,
                            source: 'inferred',
                            isActive: true,
                            embeddingModel: EMBEDDING_MODEL,
                            distillationModel: SUMMARIZATION_MODEL,
                        },
                    });

                    // Generate and store embedding for merged memory
                    const embedding = await VectorService.generateEmbedding(compressed.content, extractBearer(req));
                    const vectorString = `[${embedding.join(',')}]`;
                    await prisma.$executeRaw`UPDATE memories SET embedding = ${vectorString}::vector WHERE id = ${newMemory.id}::uuid`;

                    // Soft-deactivate source memories
                    await prisma.memory.updateMany({
                        where: { id: { in: cluster.map(m => m.id) } },
                        data: { isActive: false },
                    });

                    // Record supersedes relations
                    await prisma.memoryRelation.createMany({
                        data: cluster.map(m => ({
                            sourceMemoryId: newMemory.id,
                            targetMemoryId: m.id,
                            relationType: 'supersedes' as const,
                            strength: 1.0,
                        })),
                    });

                    await prisma.memoryExtraction.update({
                        where: { id: extraction.id },
                        data: {
                            status: 'completed',
                            savedCount: 1,
                            completedAt: new Date(),
                        },
                    });

                    clustersCompressed++;
                    memoriesDeactivated += cluster.length;
                } catch (clusterErr) {
                    logger.error(
                        { err: clusterErr, extraction_id: extraction.id },
                        'Failed to compress cluster'
                    );
                    await prisma.memoryExtraction.update({
                        where: { id: extraction.id },
                        data: { status: 'failed' },
                    });
                }
            }

            logger.info({
                user_id: userId,
                duration_ms: Date.now() - startTime,
                status: 'success',
                metrics: { clusters_found: clusters.length, clustersCompressed, memoriesDeactivated },
            }, 'Memory compression completed');

            res.json({
                clusters_found: clusters.length,
                clusters_compressed: clustersCompressed,
                memories_deactivated: memoriesDeactivated,
                dry_run: false,
            });

        } catch (error) {
            logger.error(
                {
                    error: error instanceof Error ? error.message : String(error),
                    operation: 'compress-memories',
                    user_id: userId,
                },
                'Error compressing memories'
            );
            res.status(500).json({ error: 'Internal server error' });
        }
    }
}
