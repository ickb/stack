import { errnoCode, firstSymlinkInPath } from "@ickb/node-utils";
import { mkdir } from "node:fs/promises";
import { displayPath, isInside } from "../args/supervisorPaths.ts";
import { dirname, parse } from "../runtime/shared/supervisorConstants.ts";
import type { SupervisorPlan } from "../runtime/shared/supervisorTypes.ts";

export async function prepareOutputDirectory(plan: SupervisorPlan): Promise<void> {
  await assertNoSymlinkedOutputAncestors(plan);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- The CLI constrains output paths to ignored supervisor or validation-run directories.
  await mkdir(dirname(plan.outDir), { recursive: true });
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Exclusive creation reserves the validated output path for this run.
    await mkdir(plan.outDir);
  } catch (error) {
    if (errnoCode(error) === "EEXIST") {
      throw new Error(`Output directory already exists: ${plan.relativeOutDir}`, {
        cause: error,
      });
    }
    throw error;
  }
}

async function assertNoSymlinkedOutputAncestors(plan: SupervisorPlan): Promise<void> {
  const base = isInside(plan.rootDir, plan.outDir)
    ? plan.rootDir
    : parse(plan.outDir).root;
  const symlink = await firstSymlinkInPath(plan.outDir, base);
  if (symlink !== undefined) {
    throw new Error(
      `Refusing to write supervisor artifacts through symlinked path: ${displayPath(plan.rootDir, symlink)}`,
    );
  }
}
