/**
 * Render any prompt against the frozen fixture. Backs GET /v1/prompts/:id/rendered.
 *
 * The fixture comes from PROMPT_FIXTURE in the generated module rather than from disk,
 * because prompts/ is not present in the production image.
 */
import { PROMPT_FIXTURE } from "./generated";
import { getPrompt, renderPrompt } from ".";

const fixture = PROMPT_FIXTURE as unknown as Record<string, unknown>;

export function renderWithFixture(id: string): string {
  const entry = getPrompt(id);
  const variables: Record<string, string> = {};
  for (const name of entry.meta.variables ?? []) {
    const value = fixture[name];
    // A visible placeholder beats throwing: this endpoint is for reading prompts, and a
    // new variable with no fixture value should still render.
    variables[name] = value === undefined ? `<${name}>` : String(value);
  }
  return renderPrompt(id, variables);
}
