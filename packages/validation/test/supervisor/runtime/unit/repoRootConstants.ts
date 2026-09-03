import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { repoRoot as supervisorRepoRoot } from "../../../../src/supervisor/runtime/shared/supervisorConstants.ts";
import { repoRoot as liveStimulusRepoRoot } from "../../../../src/supervisor/stimulus/shared/liveBotStimulusConstants.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url));

it("resolves validation live-path defaults from the checkout root", () => {
  expect(supervisorRepoRoot).toBe(REPO_ROOT);
  expect(liveStimulusRepoRoot).toBe(REPO_ROOT);
});
