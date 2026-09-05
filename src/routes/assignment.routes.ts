import { Router } from "express";
import { AssignmentController } from "../controllers/assignment.controller";
import { authenticate, requireRoles } from "../middleware/auth.middleware";
import { AI_APP_ROLES } from "../lib/roles";
import { validate } from "../middleware/validate";
import { retrieveMemoriesSchema } from "../schemas";

const router = Router();

router.use(authenticate);
router.use(requireRoles(...AI_APP_ROLES));

router.patch("/:id/settings", AssignmentController.updateSettings);
router.post(
  "/:id/memories/retrieve",
  validate(retrieveMemoriesSchema),
  AssignmentController.retrieveMemories,
);

export default router;
