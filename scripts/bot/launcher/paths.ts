import path from "node:path";

import { defaultLogRoot, logDirectoryLabel } from "./runtime/constants.ts";
import type { LauncherPathsOptions } from "./runtime/types.ts";

export function resolveLauncherPaths({
  cliLogRoot,
  envLogRoot,
  logDir,
  root,
}: LauncherPathsOptions): { logDir: string; logRoot: string } {
  const logRoot = resolveConfiguredPath(
    cliLogRoot ?? envLogRoot ?? defaultLogRoot,
    root,
    "log root",
  );
  const resolvedLogDir =
    logDir === undefined
      ? path.join(logRoot, "bot")
      : resolveConfiguredPath(logDir, root, logDirectoryLabel);

  assertContained(logRoot, resolvedLogDir, logDirectoryLabel);
  return { logDir: resolvedLogDir, logRoot };
}

function resolveConfiguredPath(value: string, root: string, label: string): string {
  if (value === "") {
    throw new Error(`Empty ${label} path`);
  }
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
}

function assertContained(root: string, candidate: string, label: string): void {
  const relationship = path.relative(root, candidate);
  if (isContainedRelationship(relationship)) {
    return;
  }
  throw new Error(`${label} must stay inside the resolved log root`);
}

function isContainedRelationship(relationship: string): boolean {
  return (
    relationship === "" ||
    (relationship !== ".." &&
      !relationship.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relationship))
  );
}
