import { Router } from 'express';
import { MemoryController } from '../controllers/memory.controller';
import { authenticate, requireRoles } from '../middleware/auth.middleware';
import { AI_APP_ROLES } from '../lib/roles';
import { validate } from '../middleware/validate';
import {
    createMemorySchema,
    updateMemorySchema,
    searchMemoriesSchema,
    compressMemoriesSchema,
    memoryFeedbackSchema,
} from '../schemas';

const router = Router();

router.use(authenticate);
router.use(requireRoles(...AI_APP_ROLES));

router.get('/stats', MemoryController.getStats);
router.get('/', MemoryController.listMemories);
router.get('/:id', MemoryController.getMemory);
/**
 * @openapi
 * /v1/memories:
 *   post:
 *     summary: Create a memory (auto-embedded via the configured embedding model)
 *     tags: [Memories]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content: { type: string }
 *               category: { type: string, enum: [persona, preference, fact, instruction, context] }
 *               importance: { type: string, enum: [critical, high, medium, low] }
 *               tags: { type: array, items: { type: string } }
 *     responses:
 *       '201': { description: Memory created }
 *       '400': { description: Validation error }
 */
router.post('/', validate(createMemorySchema), MemoryController.createMemory);
router.patch('/:id', validate(updateMemorySchema), MemoryController.updateMemory);
router.post('/:id/feedback', validate(memoryFeedbackSchema), MemoryController.submitFeedback);
router.delete('/:id', MemoryController.deleteMemory);

// Search endpoint from design
router.post('/search', validate(searchMemoriesSchema), MemoryController.searchMemories);

// Memory compression: cluster similar memories and merge via LLM
router.post('/compress', validate(compressMemoriesSchema), MemoryController.compressMemories);

export default router;
