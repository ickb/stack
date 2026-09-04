import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { repoRoot } from "../../../../src/supervisor/runtime/shared/supervisorConstants.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url));

it("resolves validation live-path defaults from the checkout root", () => {
  expect(repoRoot).toBe(REPO_ROOT);
});
