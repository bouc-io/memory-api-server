import { z } from "zod";

/**
 * Request body schemas for memory-api-server mutating routes.
 * Objects use .passthrough() so unknown keys are preserved while known fields
 * are type-checked. Apply with the validate() middleware.
 */

const category = z.enum([
  "persona",
  "preference",
  "fact",
  "instruction",
  "context",
]);
const importance = z.enum(["critical", "high", "medium", "low"]);
const metadata = z.record(z.string(), z.unknown());

export const createMemorySchema = z
  .object({
    content: z.string().min(1, "content is required"),
    category: category.optional(),
    importance: importance.optional(),
    tags: z.array(z.string()).optional(),
    metadata: metadata.optional(),
    distillation_model: z.string().optional(),
    source: z.string().optional(),
    memory_type: z.string().optional(),
    session_shared: z.boolean().optional(),
  })
  .passthrough();

export const updateMemorySchema = z
  .object({
    content: z.string().min(1).optional(),
    category: category.optional(),
    importance: importance.optional(),
    tags: z.array(z.string()).optional(),
    is_active: z.boolean().optional(),
  })
  .passthrough();

export const searchMemoriesSchema = z
  .object({
    query: z.string().min(1, "query is required"),
    limit: z.number().int().positive().optional(),
    min_relevance: z.number().min(0).max(1).optional(),
    filters: metadata.optional(),
  })
  .passthrough();

export const compressMemoriesSchema = z
  .object({
    min_cluster_size: z.number().int().positive().optional(),
    dry_run: z.boolean().optional(),
  })
  .passthrough();

export const memoryFeedbackSchema = z
  .object({ rating: z.enum(["helpful", "unhelpful", "wrong"]) })
  .passthrough();

export const retrieveMemoriesSchema = z
  .object({
    query: z.string().optional(),
    limit: z.number().int().positive().optional(),
  })
  .passthrough();
