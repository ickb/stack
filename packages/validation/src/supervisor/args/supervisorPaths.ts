import { firstSymlinkInPath, minimalProcessEnv } from "@ickb/node-utils";
import { spawnSync } from "node:child_process";
import pathModule from "node:path";
import {
  SUPERVISOR_OUTPUT_ROOT,
  isAbsolute,
  relative,
  repoRoot,
} from "../runtime/shared/supervisorConstants.ts";
import type {
  Dependencies,
  ParsedArgs,
  SupervisorPlan,
} from "../runtime/shared/supervisorTypes.ts";

/**
 * Resolves CLI options into concrete config paths and safety-checked outputs.
 *
 * @remarks
 * Config paths must stay inside the repo and be git-ignored. Output paths are
 * limited to supervisor output roots or validation run directories; ignored-path
 * checks apply when the chosen output lives inside the repo.
 */
export function resolvePlan(
  args: ParsedArgs,
  rootDir = repoRoot,
  dependencies: Dependencies = {},
): SupervisorPlan {
  const runId = createRunId();
  const outDir = resolveConfiguredPath(
    rootDir,
    args.outDir ?? `log/live-supervisor/${runId}`,
    "Output directory",
  );
  const relativeOutDir = displayPath(rootDir, outDir);
  const botConfigPath = insideRepoPath(rootDir, args.botConfigPath, "Bot config path");
  const testerConfigPath = insideRepoPath(
    rootDir,
    args.testerConfigPath,
    "Tester config path",
  );
  assertSupervisorOutputDirectory(outDir, relativeOutDir);
  if (
    isInside(rootDir, outDir) &&
    !isIgnoredPath(rootDir, relativeOutDir, dependencies)
  ) {
    throw new Error(
      `Refusing to write non-ignored supervisor output directory: ${relativeOutDir}`,
    );
  }
  assertIgnoredConfigPath(rootDir, botConfigPath, "Bot config path", dependencies);
  assertIgnoredConfigPath(rootDir, testerConfigPath, "Tester config path", dependencies);

  return {
    runId,
    rootDir,
    botConfigPath,
    testerConfigPath,
    outDir,
    relativeOutDir,
    targetOutcomes: [...new Set(args.targetOutcomes)],
    testerScenario: args.testerScenario,
    testerFee: args.testerFee,
    testerFeeBase: args.testerFeeBase,
    commandTimeoutSeconds: args.commandTimeoutSeconds,
  };
}

function insideRepoPath(rootDir: string, configuredPath: string, label: string): string {
  const absolutePath = resolveConfiguredPath(rootDir, configuredPath, label);
  if (!isInside(rootDir, absolutePath)) {
    throw new Error(`${label} must stay inside the repo`);
  }
  return absolutePath;
}

function resolveConfiguredPath(
  rootDir: string,
  configuredPath: string,
  label: string,
): string {
  if (configuredPath === "") {
    throw new Error(`${label} must not be empty`);
  }
  return isAbsolute(configuredPath)
    ? pathModule.resolve(configuredPath)
    : pathModule.resolve(rootDir, configuredPath);
}

function assertSupervisorOutputDirectory(outDir: string, relativeOutDir: string): void {
  if (
    relativeOutDir === "log/live-supervisor" ||
    relativeOutDir.startsWith(SUPERVISOR_OUTPUT_ROOT) ||
    isValidationRunOutputDirectory(outDir)
  ) {
    return;
  }
  throw new Error(
    `Supervisor output directory must be under ${SUPERVISOR_OUTPUT_ROOT} or a validation session run directory`,
  );
}

function isValidationRunOutputDirectory(candidatePath: string): boolean {
  const parts = candidatePath.split(/[\\/]+/u);
  if (parts.length < 5) {
    return false;
  }
  return /^validation\/[^/]+\/chunks\/chunk-\d{4}\/run-\d{4}$/u.test(
    parts.slice(-5).join("/"),
  );
}

function assertIgnoredConfigPath(
  rootDir: string,
  absolutePath: string,
  label: string,
  dependencies: Dependencies,
): void {
  const relativePath = relative(rootDir, absolutePath);
  if (!isIgnoredPath(rootDir, relativePath, dependencies)) {
    throw new Error(`Refusing to use non-ignored ${label}: ${relativePath}`);
  }
}

export async function assertNoSymlinkedConfigPath(
  rootDir: string,
  absolutePath: string,
  label: string,
): Promise<void> {
  const symlink = await firstSymlinkInPath(absolutePath, rootDir);
  if (symlink !== undefined) {
    throw new Error(
      `Refusing to use ${label} through symlinked path: ${relative(rootDir, symlink)}`,
    );
  }
}

function isIgnoredPath(
  rootDir: string,
  relativePath: string,
  dependencies: Dependencies,
): boolean {
  const spawnSyncCommand = dependencies.spawnSyncCommand ?? spawnSync;
  const result = spawnSyncCommand(
    "git",
    ["-C", rootDir, "check-ignore", "--", relativePath],
    {
      encoding: "utf8",
      env: minimalProcessEnv(process.env),
    },
  );
  return result.status === 0;
}

export function displayPath(rootDir: string, path: string): string {
  return isInside(rootDir, path) ? relative(rootDir, path) : path;
}

export function isInside(rootDir: string, path: string): boolean {
  const relativePath = relative(rootDir, path);
  return (
    relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function createRunId(): string {
  return new Date().toISOString().replaceAll(/[:.]/gu, "-");
}
