import pathModule from "node:path";

import { logDirectoryLabel } from "./constants.ts";
import type { CollectorRunArgs, IncidentPaths } from "./types.ts";

const { isAbsolute, join, relative, resolve, sep } = pathModule;

export function resolveIncidentPaths({
  parsed,
  envLogRoot,
  root,
}: {
  envLogRoot?: string;
  parsed: CollectorRunArgs;
  root: string;
}): IncidentPaths {
  const logRootSource = logRootSourceLabel(parsed.logRoot, envLogRoot);
  const logRoot = resolveConfiguredPath(
    parsed.logRoot ?? envLogRoot ?? "log",
    root,
    "log root",
  );
  const logDir =
    parsed.logDir === undefined
      ? join(logRoot, "bot")
      : resolveConfiguredPath(parsed.logDir, root, logDirectoryLabel);
  assertContained(logRoot, logDir, logDirectoryLabel);
  return {
    logDir,
    logRoot,
    logRootSource,
  };
}

export function relationshipEscapesRoot(relationship: string): boolean {
  return (
    relationship === "" ||
    relationship === ".." ||
    relationship.startsWith(`..${sep}`) ||
    relationship.includes("\0") ||
    isAbsolute(relationship)
  );
}

export function shellQuote(value: string): string {
  const escaped = value.replaceAll("'", String.raw`'\''`);
  return `'${escaped}'`;
}

function logRootSourceLabel(
  cliLogRoot: string | undefined,
  envLogRoot: string | undefined,
): string {
  if (cliLogRoot !== undefined) {
    return "cli";
  }
  return envLogRoot === undefined ? "default:log" : "env:ICKB_BOT_LOG_ROOT";
}

function resolveConfiguredPath(value: string, root: string, label: string): string {
  if (value === "") {
    throw new Error(`Empty ${label} path`);
  }
  return isAbsolute(value) ? resolve(value) : resolve(root, value);
}

function assertContained(root: string, candidate: string, label: string): void {
  const relationship = relative(root, candidate);
  const escapesRoot =
    relationship === ".." ||
    relationship.startsWith(`..${sep}`) ||
    isAbsolute(relationship);

  if (escapesRoot) {
    throw new Error(`${label} must stay inside the resolved log root`);
  }
}
