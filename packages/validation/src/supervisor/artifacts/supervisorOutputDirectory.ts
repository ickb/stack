import { firstSymlinkInPath } from "@ickb/node-utils";
import { existsSync } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { displayPath, isInside } from "../args/supervisorPaths.ts";
import { dirname, join, parse, relative } from "../runtime/shared/supervisorConstants.ts";
import {
  isAlreadyExistsError,
  isNotFoundError,
} from "../runtime/shared/supervisorEvidence.ts";
import type { Dependencies, SupervisorPlan } from "../runtime/shared/supervisorTypes.ts";

export async function prepareOutputDirectory(
  plan: SupervisorPlan,
  dependencies: Dependencies,
): Promise<void> {
  const mkdirFn = dependencies.mkdir ?? mkdir;
  await assertNoSymlinkedOutputAncestors(plan, dependencies);
  await mkdirFn(dirname(plan.outDir), { recursive: true });
  await assertNoSymlinkedOutputAncestors(plan, dependencies);
  try {
    await mkdirFn(plan.outDir);
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      throw new Error(`Output directory already exists: ${plan.relativeOutDir}`, {
        cause: error,
      });
    }
    throw error;
  }
  await assertRealOutputDirectory(plan, dependencies);
}

async function assertNoSymlinkedOutputAncestors(
  plan: SupervisorPlan,
  dependencies: Dependencies,
): Promise<void> {
  const base = isInside(plan.rootDir, plan.outDir)
    ? plan.rootDir
    : parse(plan.outDir).root;
  const symlink = await firstSymlinkInPath(plan.outDir, base, {
    ...(dependencies.lstat === undefined ? {} : { lstat: dependencies.lstat }),
  });
  if (symlink !== undefined) {
    throw new Error(
      `Refusing to write supervisor artifacts through symlinked path: ${displayPath(plan.rootDir, symlink)}`,
    );
  }
}

async function assertRealOutputDirectory(
  plan: SupervisorPlan,
  dependencies: Dependencies,
): Promise<void> {
  const realpathFn = dependencies.realpath ?? realpath;
  let realRoot: string;
  let realOutDir: string;
  try {
    [realRoot, realOutDir] = await Promise.all([
      realpathFn(plan.rootDir),
      realpathFn(plan.outDir),
    ]);
  } catch (error) {
    if (dependencies.mkdir !== undefined && isNotFoundError(error)) {
      return;
    }
    throw error;
  }
  if (isInside(plan.rootDir, plan.outDir) && !isInside(realRoot, realOutDir)) {
    throw new Error("Supervisor output directory must stay inside the repo");
  }
}

export function assertBuiltRuntime(
  plan: SupervisorPlan,
  dependencies: Dependencies,
): void {
  const required = [
    ["live preflight script", join(plan.rootDir, "scripts/live/preflight.ts")],
  ] as const;
  const exists = dependencies.existsSync ?? existsSync;
  for (const [label, runtimePath] of required) {
    if (!exists(runtimePath)) {
      throw new Error(`Missing built ${label}: ${relative(plan.rootDir, runtimePath)}`);
    }
  }
}
