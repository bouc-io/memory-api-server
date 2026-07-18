import { Memory, MemoryCategory, MemoryImportance, Prisma } from '@prisma/client';
import prisma from './prisma.service';
import { VectorService } from './vector.service';
import { chat } from './llm.service';
import { createComponentLogger } from '../lib/logger';

const logger = createComponentLogger('summarization-service');

// Cosine similarity threshold above which two memories are "about the same thing"
const SIMILARITY_THRESHOLD = 0.90;

export interface ClusterResult {
    clusters: Memory[][];
}

export interface CompressedMemory {
    content: string;
    importance: MemoryImportance;
    category: MemoryCategory;
}

/**
 * Fetch all active memories with embeddings for a user and group them into
 * clusters where every pair has cosine similarity above SIMILARITY_THRESHOLD.
 *
 * Uses a greedy connected-components approach:
 *  1. Retrieve embedding vectors for all active memories via raw SQL.
 *  2. For each pair compute cosine similarity using pgvector.
 *  3. Build an adjacency list and find connected components (BFS).
 *  4. Return components with at least `minSize` members.
 */
export async function findClusters(
    userId: string,
    orgId: string | null = null,
    threshold: number = SIMILARITY_THRESHOLD,
    minSize: number = 3
): Promise<ClusterResult> {
    const orgFilter = orgId
        ? Prisma.sql`AND org_id = ${orgId}`
        : Prisma.sql``;

    // Fetch memories that have embeddings
    const memoriesWithEmbeddings = await prisma.$queryRaw<
        Array<{ id: string; content: string; category: string; importance: string }>
    >(Prisma.sql`
        SELECT id::text, content, category::text, importance::text
        FROM memories
        WHERE user_id = ${userId}
        ${orgFilter}
        AND is_active = true
        AND embedding IS NOT NULL
    `);

    if (memoriesWithEmbeddings.length < minSize) {
        return { clusters: [] };
    }

    const ids = memoriesWithEmbeddings.map(m => m.id);

    // Compute pairwise cosine similarity using pgvector; only store pairs above threshold
    // We compare every memory against all others in a single self-join query
    const pairs = await prisma.$queryRaw<Array<{ a: string; b: string }>>(Prisma.sql`
        SELECT a.id::text AS a, b.id::text AS b
        FROM memories a
        JOIN memories b ON a.id < b.id
        WHERE a.user_id = ${userId}
        AND b.user_id = ${userId}
        ${orgId ? Prisma.sql`AND a.org_id = ${orgId} AND b.org_id = ${orgId}` : Prisma.sql``}
        AND a.is_active = true
        AND b.is_active = true
        AND a.embedding IS NOT NULL
        AND b.embedding IS NOT NULL
        AND (1 - (a.embedding <=> b.embedding)) >= ${threshold}
        AND a.id::text = ANY(${ids}::text[])
        AND b.id::text = ANY(${ids}::text[])
    `);

    if (pairs.length === 0) {
        return { clusters: [] };
    }

    // Build adjacency list from pairs
    const adjacency = new Map<string, Set<string>>();
    for (const { a, b } of pairs) {
        if (!adjacency.has(a)) adjacency.set(a, new Set());
        if (!adjacency.has(b)) adjacency.set(b, new Set());
        adjacency.get(a)!.add(b);
        adjacency.get(b)!.add(a);
    }

    // BFS to find connected components
    const visited = new Set<string>();
    const components: string[][] = [];

    for (const node of adjacency.keys()) {
        if (visited.has(node)) continue;
        const component: string[] = [];
        const queue = [node];
        while (queue.length > 0) {
            const current = queue.shift()!;
            if (visited.has(current)) continue;
            visited.add(current);
            component.push(current);
            for (const neighbor of adjacency.get(current) ?? []) {
                if (!visited.has(neighbor)) queue.push(neighbor);
            }
        }
        if (component.length >= minSize) {
            components.push(component);
        }
    }

    if (components.length === 0) {
        return { clusters: [] };
    }

    // Load full Memory records for each component
    const memoryMap = new Map(memoriesWithEmbeddings.map(m => [m.id, m]));
    const clusters: Memory[][] = await Promise.all(
        components.map(async (ids) => {
            return prisma.memory.findMany({
                where: { id: { in: ids } },
            });
        })
    );

    return { clusters };
}

/**
 * Use the LLM to merge a cluster of similar memories into a single concise memory.
 * Importance is elevated to the highest level found in the cluster.
 * Category is chosen by majority vote.
 */
export async function compressCluster(cluster: Memory[]): Promise<CompressedMemory> {
    const contents = cluster.map((m, i) => `${i + 1}. ${m.content}`).join('\n');

    const systemPrompt =
        'You are a memory compression assistant. Given a list of related memories about the same person, ' +
        'merge them into ONE concise memory (max 2 sentences). ' +
        'Preserve all important facts. Output ONLY the merged memory text, nothing else.';

    const userPrompt = `Merge these ${cluster.length} memories into one:\n${contents}`;

    let mergedContent: string;
    try {
        mergedContent = await chat(
            [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            { temperature: 0.2, max_tokens: 200 }
        );
    } catch (err) {
        logger.error({ err }, 'LLM summarization failed, falling back to first memory');
        mergedContent = cluster[0].content;
    }

    // Determine output importance: promote to highest level in cluster
    const importanceOrder: MemoryImportance[] = ['critical', 'high', 'medium', 'low'];
    const importance = importanceOrder.find(level =>
        cluster.some(m => m.importance === level)
    ) ?? 'medium';

    // Category: majority vote
    const categoryCounts = new Map<MemoryCategory, number>();
    for (const m of cluster) {
        categoryCounts.set(m.category, (categoryCounts.get(m.category) ?? 0) + 1);
    }
    const category = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

    return { content: mergedContent, importance, category };
}
