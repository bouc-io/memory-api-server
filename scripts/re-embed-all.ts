/**
 * Re-embedding script: regenerates all memory embeddings using the configured model.
 * Run this whenever you switch EMBEDDING_MODEL to a different model.
 *
 * Usage: npm run migrate:re-embed
 *
 * Prerequisites:
 *   - Ollama must be running with the target model pulled (e.g. nomic-embed-text)
 *   - OLLAMA_URL and EMBEDDING_MODEL env vars must be set (or use defaults)
 *   - Database must have the dimensionless vector migration applied (20260303000001)
 */
import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { VectorService, EMBEDDING_MODEL } from '../src/services/vector.service';

const prisma = new PrismaClient();

const BATCH_LOG_INTERVAL = 50;

async function main() {
    console.log('=== Re-embedding Migration Script ===');
    console.log(`OLLAMA_URL: ${process.env.OLLAMA_URL || 'http://localhost:11434'}`);
    console.log(`EMBEDDING_MODEL: ${process.env.EMBEDDING_MODEL || 'bge-m3:567m'}`);
    console.log('');

    // Initialize the Ollama-based VectorService
    console.log('Initializing VectorService...');
    await VectorService.initialize();
    const meta = VectorService.getMetadata();
    console.log(`Model: ${meta.model}, Dimension: ${meta.dimension}, Ready: ${meta.ready}`);
    console.log('');

    // Fetch all memories
    const memories = await prisma.memory.findMany({
        select: { id: true, content: true },
        orderBy: { createdAt: 'asc' },
    });

    console.log(`Found ${memories.length} memories to re-embed.`);
    console.log('');

    const startTime = Date.now();
    let successCount = 0;
    let errorCount = 0;
    const errors: Array<{ id: string; error: string }> = [];

    for (let i = 0; i < memories.length; i++) {
        const memory = memories[i];

        try {
            const embedding = await VectorService.generateEmbedding(memory.content);
            const vectorString = `[${embedding.join(',')}]`;
            await prisma.$executeRaw`UPDATE memories SET embedding = ${vectorString}::vector, embedding_model = ${EMBEDDING_MODEL} WHERE id = ${memory.id}::uuid`;
            successCount++;
        } catch (error) {
            errorCount++;
            const errMsg = error instanceof Error ? error.message : String(error);
            errors.push({ id: memory.id, error: errMsg });
            console.error(`  ERROR [${memory.id}]: ${errMsg}`);
        }

        // Progress logging
        const processed = i + 1;
        if (processed % BATCH_LOG_INTERVAL === 0 || processed === memories.length) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`  Progress: ${processed}/${memories.length} (${elapsed}s elapsed)`);
        }
    }

    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('');
    console.log('=== Migration Complete ===');
    console.log(`Total:     ${memories.length}`);
    console.log(`Success:   ${successCount}`);
    console.log(`Errors:    ${errorCount}`);
    console.log(`Duration:  ${totalElapsed}s`);

    if (errors.length > 0) {
        console.log('');
        console.log('Failed memories:');
        for (const err of errors) {
            console.log(`  - ${err.id}: ${err.error}`);
        }
    }

    await prisma.$disconnect();
    process.exit(errorCount > 0 ? 1 : 0);
}

main().catch((error) => {
    console.error('Fatal error during re-embedding migration:', error);
    prisma.$disconnect();
    process.exit(1);
});
