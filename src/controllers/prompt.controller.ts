import { Request, Response } from "express";
import { createComponentLogger } from "../lib/logger";
import {
  PROMPTSET_HASH,
  PROMPTSET_VERSION,
  getPrompt,
  hasPrompt,
  listPrompts,
} from "../prompts";
import { renderWithFixture } from "../prompts/fixtureRender";

const logger = createComponentLogger("prompt-controller");

/* eslint-disable @typescript-eslint/no-require-imports */
const pkg = require("../../package.json") as { version: string; name: string };
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Read-only prompt registry. Prompt text is owned by git; there is no write path here on
 * purpose, so a promptset hash always maps to exactly one commit.
 */
export class PromptController {
  /** GET /v1/prompts */
  static async list(_req: Request, res: Response) {
    try {
      const prompts = listPrompts();
      res.json({
        promptset_version: PROMPTSET_VERSION,
        promptset_hash: PROMPTSET_HASH,
        count: prompts.length,
        prompts: prompts.map((meta) => ({
          id: meta.id,
          title: meta.title,
          version: meta.version,
          stage: meta.stage,
          role: meta.role,
          hash: meta.hash,
          variables: meta.variables ?? [],
        })),
      });
    } catch (error) {
      logger.error({ err: error }, "Error listing prompts");
      res.status(500).json({
        error: { code: "INTERNAL_ERROR", message: "Failed to list prompts" },
      });
    }
  }

  /** GET /v1/prompts/:id */
  static async get(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      if (!hasPrompt(id)) {
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: `Unknown prompt id: ${id}` },
        });
      }
      const entry = getPrompt(id);
      res.json({
        id: entry.meta.id,
        title: entry.meta.title,
        version: entry.meta.version,
        stage: entry.meta.stage,
        role: entry.meta.role,
        hash: entry.hash,
        variables: entry.meta.variables ?? [],
        note: entry.meta.note ?? null,
        template: entry.template,
        promptset_version: PROMPTSET_VERSION,
        promptset_hash: PROMPTSET_HASH,
      });
    } catch (error) {
      logger.error({ err: error }, "Error getting prompt");
      res.status(500).json({
        error: { code: "INTERNAL_ERROR", message: "Failed to get prompt" },
      });
    }
  }

  /** GET /v1/prompts/:id/rendered */
  static async rendered(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      if (!hasPrompt(id)) {
        return res.status(404).json({
          error: { code: "NOT_FOUND", message: `Unknown prompt id: ${id}` },
        });
      }
      const rendered = renderWithFixture(id);
      res.json({
        id,
        fixture: "default",
        promptset_version: PROMPTSET_VERSION,
        promptset_hash: PROMPTSET_HASH,
        rendered,
        rendered_length: rendered.length,
      });
    } catch (error) {
      logger.error({ err: error }, "Error rendering prompt");
      res.status(500).json({
        error: { code: "INTERNAL_ERROR", message: "Failed to render prompt" },
      });
    }
  }

  /** GET /v1/promptset */
  static async promptset(_req: Request, res: Response) {
    try {
      res.json({
        promptset_version: PROMPTSET_VERSION,
        promptset_hash: PROMPTSET_HASH,
        unit_count: listPrompts().length,
        service: pkg.name,
        service_version: pkg.version,
      });
    } catch (error) {
      logger.error({ err: error }, "Error getting promptset");
      res.status(500).json({
        error: { code: "INTERNAL_ERROR", message: "Failed to get promptset" },
      });
    }
  }
}
