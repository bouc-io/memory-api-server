import { Router } from "express";
import { PromptController } from "../controllers/prompt.controller";
import { authenticate, requireRoles } from "../middleware/auth.middleware";
import { BOUC_ROLES } from "../lib/roles";

const router = Router();

// Mounted at /v1/memories, AHEAD of memory.routes in index.ts, so these paths resolve
// before memory.routes' `/:id` can match the literal segment "prompts". That matters more
// here than in the agent: this service's ids are @db.Uuid, so a fallthrough would reach
// Prisma with a non-UUID and fail, rather than simply 404.
//
// Guards are applied PER ROUTE, never via router.use(): a router-level guard would reject
// every /v1/memories/* request before it could fall through to memory.routes. Both
// middlewares are needed because requireRoles in this service does not authenticate.
//
// Any bouc.io staff role (BOUC_ROLES). Deliberately NOT ADMIN_PORTAL_ROLES, which includes
// ORG_ADMIN and ORG_ADMIN_ENTERPRISE, i.e. customer administrators. BOUC_ROLES does not
// overlap AI_APP_ROLES except for bouc_user, which is why these cannot simply live inside
// memory.routes behind its blanket guard.
const promptGuards = [authenticate, requireRoles(...BOUC_ROLES)];

/**
 * @openapi
 * /v1/memories/prompts:
 *   get:
 *     summary: List every prompt with its version and hash
 *     tags: [Prompts]
 *     responses:
 *       '200':
 *         description: The promptset inventory for this service
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 promptset_version: { type: string }
 *                 promptset_hash: { type: string }
 *                 count: { type: integer }
 *                 prompts:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string }
 *                       title: { type: string }
 *                       version: { type: integer }
 *                       stage: { type: string }
 *                       role: { type: string }
 *                       hash: { type: string }
 *                       variables: { type: array, items: { type: string } }
 *       '401': { description: Unauthorized }
 *       '403': { description: Forbidden — requires a bouc.io staff role }
 */
router.get("/prompts", ...promptGuards, PromptController.list);

/**
 * @openapi
 * /v1/memories/prompts/{id}/rendered:
 *   get:
 *     summary: Render a prompt against the frozen fixture
 *     tags: [Prompts]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       '200':
 *         description: Fully rendered prompt text
 *       '401': { description: Unauthorized }
 *       '403': { description: Forbidden — requires a bouc.io staff role }
 *       '404': { description: Unknown prompt id }
 */
router.get("/prompts/:id/rendered", ...promptGuards, PromptController.rendered);

/**
 * @openapi
 * /v1/memories/prompts/{id}:
 *   get:
 *     summary: Get one prompt's template and metadata
 *     tags: [Prompts]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       '200':
 *         description: Template as authored, plus metadata
 *       '401': { description: Unauthorized }
 *       '403': { description: Forbidden — requires a bouc.io staff role }
 *       '404': { description: Unknown prompt id }
 */
router.get("/prompts/:id", ...promptGuards, PromptController.get);

/**
 * @openapi
 * /v1/memories/promptset:
 *   get:
 *     summary: Promptset version and hash for this service
 *     tags: [Prompts]
 *     responses:
 *       '200':
 *         description: Version handle for this deployment
 *       '401': { description: Unauthorized }
 *       '403': { description: Forbidden — requires a bouc.io staff role }
 */
router.get("/promptset", ...promptGuards, PromptController.promptset);

export default router;
