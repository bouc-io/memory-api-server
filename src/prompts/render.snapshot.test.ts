/**
 * Golden renders of every prompt, one file per id under prompts/__snapshots__/.
 *
 * Purpose is review, not assertion: a prompt change shows up in a merge request as a
 * readable before/after of the text the model receives. Intentional edits are committed
 * with `npx vitest run -u src/prompts`.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { promptsDir } from "./codegen";
import { PROMPTS } from ".";
import { renderWithFixture } from "./fixtureRender";

describe("rendered prompt goldens", () => {
  for (const id of Object.keys(PROMPTS).sort()) {
    it(id, async () => {
      await expect(renderWithFixture(id)).toMatchFileSnapshot(
        path.join(promptsDir, "__snapshots__", `${id}.txt`),
      );
    });
  }
});
