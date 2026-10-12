/* eslint-disable */
// GENERATED FILE — do not edit by hand.
// Source: prompts/**/*.md
// Regenerate: npm run prompts:build
//
// Committed on purpose: this file is the promptset lock. 'npm run prompts:check' and
// src/prompts/drift.test.ts fail when it no longer matches the .md sources, which is
// what keeps the recorded promptset hash honest about what actually shipped.

export interface PromptMeta {
  id: string;
  title: string;
  version: number;
  stage: string;
  role: string;
  includes?: string[];
  variables?: string[];
  note?: string;
}

export interface PromptEntry {
  meta: PromptMeta;
  /** Include-resolved template. Placeholders are {{name}}. */
  template: string;
  /** sha256 of template. */
  hash: string;
}

export const PROMPTSET_VERSION = "1.0.0";
export const PROMPTSET_HASH = "30813b1b1934d6c90b01bd053b23706bb7307b4bb01e45d0defd37367265a31b";

/**
 * prompts/fixtures/default.json, embedded because the production image copies only
 * dist/, node_modules/ and prisma/ — the prompts/ directory is not present at runtime,
 * and GET /v1/prompts/:id/rendered needs these inputs. Deliberately excluded from
 * PROMPTSET_HASH: it is test data, not prompt text. Editing it still shows up as drift
 * in this file and as a diff in the committed goldens.
 */
export const PROMPT_FIXTURE = {
  "_note": "Frozen inputs for GET /v1/prompts/:id/rendered and the committed goldens. Changing this file changes the rendered output — treat it as test data.",
  "count": 3,
  "contents": "1. The user prefers concise answers.\n2. The user asked for shorter replies.\n3. The user said long answers are unhelpful."
} as const;

export const PROMPTS: Record<string, PromptEntry> = {
  "compression.input": {
    meta: {"id":"compression.input","title":"Memory cluster compression input","version":1,"stage":"compression","role":"user","variables":["count","contents"],"note":"contents is a 1-based numbered list, one memory per line, built by the caller."},
    template: "Merge these {{count}} memories into one:\n{{contents}}",
    hash: "cbbbe61a4c7241e100395595d6703bd36f287ee2ab35eadfda2c185d6d3bf5f2",
  },
  "compression.system": {
    meta: {"id":"compression.system","title":"Memory cluster compression system prompt","version":1,"stage":"compression","role":"system","note":"Merges a cluster of near-duplicate memories (cosine similarity >= 0.90) into one. Two known weaknesses preserved verbatim from the pre-extraction code: it assumes every cluster is \"about the same person\", which is untrue for fact and context memories, and it is never told the target category even though the caller picks one by majority vote and the importance by maximum. Fixing either changes output and needs its own eval.\n"},
    template: "You are a memory compression assistant. Given a list of related memories about the same person, merge them into ONE concise memory (max 2 sentences). Preserve all important facts. Output ONLY the merged memory text, nothing else.",
    hash: "740ddc47ebcb586223ec8008bec5967448abd6f36c1cb5522740ed28183dfe73",
  },
};
