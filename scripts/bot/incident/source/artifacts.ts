import { createHash } from "node:crypto";
import pathModule from "node:path";

import {
  assertNoSymlinkedPathComponents,
  openSourceHandle,
  readHandleText,
  safeLstat,
  safeRealpath,
} from "../io/filesystem.ts";
import { relationshipEscapesRoot } from "../model/paths.ts";
import { ignoreError, isAsciiDigit, isErrorCode, isRecord } from "../model/text.ts";
import type {
  ArtifactRef,
  IncidentDependencies,
  IncidentPaths,
  IncidentSummary,
  ReferencedArtifactOptions,
  StatLike,
} from "../model/types.ts";

const { join, relative } = pathModule;

export async function addReferencedArtifacts(
  paths: IncidentPaths,
  summary: IncidentSummary,
  outputs: Map<string, string>,
  dependencies: IncidentDependencies,
): Promise<IncidentSummary> {
  let artifactSummary = summary;
  for (const artifact of summary.artifacts.included) {
    artifactSummary = await addReferencedArtifact({
      artifact,
      dependencies,
      outputs,
      paths,
      summary: artifactSummary,
    });
  }
  return artifactSummary;
}

export function collectArtifactRefs(
  record: unknown,
  summary: IncidentSummary,
): IncidentSummary {
  return {
    ...summary,
    artifacts: {
      ...summary.artifacts,
      included: appendUniqueArtifactRefs(
        summary.artifacts.included,
        artifactRefsFrom(record),
      ),
    },
  };
}

async function addReferencedArtifact({
  artifact,
  dependencies,
  outputs,
  paths,
  summary,
}: ReferencedArtifactOptions): Promise<IncidentSummary> {
  const sourcePath = join(paths.logDir, artifact.path);
  const found = await proveArtifactSourcePath(
    paths.logDir,
    sourcePath,
    artifact.path,
    dependencies,
  );
  if (!found) {
    return appendMissingArtifact(summary, artifact);
  }

  const handle = await openSourceHandle(sourcePath, artifact.path, dependencies);
  if (handle === null) {
    return appendMissingArtifact(summary, artifact);
  }

  try {
    const text = await readHandleText(handle, artifact.path);
    const actualHash = sha256TextRef(text);
    if (actualHash !== artifact.hash) {
      return appendMismatchedArtifact(summary, artifact, actualHash);
    }
    outputs.set(artifact.path, text.endsWith("\n") ? text : `${text}\n`);
    return summary;
  } finally {
    await ignoreError(handle.close());
  }
}

async function proveArtifactSourcePath(
  logDir: string,
  sourcePath: string,
  label: string,
  dependencies: IncidentDependencies,
): Promise<boolean> {
  await assertNoSymlinkedPathComponents(sourcePath, `artifact ${label}`, dependencies);
  const stat = await optionalLstat(sourcePath, dependencies);
  if (stat === null) {
    return false;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing symlinked artifact path: ${sourcePath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`Artifact path is not a regular file: ${sourcePath}`);
  }
  const [realLogDir, realSourcePath] = await realArtifactPaths(
    logDir,
    sourcePath,
    dependencies,
  );
  const relationship = relative(realLogDir, realSourcePath);
  if (relationshipEscapesRoot(relationship)) {
    throw new Error(`Artifact path escapes the log directory: ${label}`);
  }
  return true;
}

async function optionalLstat(
  path: string,
  dependencies: IncidentDependencies,
): Promise<StatLike | null> {
  try {
    return await (dependencies.lstat ?? safeLstat)(path);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

async function realArtifactPaths(
  logDir: string,
  sourcePath: string,
  dependencies: IncidentDependencies,
): Promise<[string, string]> {
  const realpath = dependencies.realpath ?? safeRealpath;
  return Promise.all([realpath(logDir), realpath(sourcePath)]);
}

function appendMissingArtifact(
  summary: IncidentSummary,
  artifact: ArtifactRef,
): IncidentSummary {
  return {
    ...summary,
    artifacts: {
      ...summary.artifacts,
      missing: [...summary.artifacts.missing, artifact],
    },
  };
}

function appendMismatchedArtifact(
  summary: IncidentSummary,
  artifact: ArtifactRef,
  actualHash: string,
): IncidentSummary {
  return {
    ...summary,
    artifacts: {
      ...summary.artifacts,
      mismatched: [...summary.artifacts.mismatched, { ...artifact, actualHash }],
    },
  };
}

function sha256TextRef(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function appendUniqueArtifactRefs(
  existing: readonly ArtifactRef[],
  refs: readonly ArtifactRef[],
): ArtifactRef[] {
  let included = [...existing];
  for (const ref of refs) {
    if (included.some((candidate) => sameArtifactRef(candidate, ref))) {
      continue;
    }
    included = [...included, ref];
  }
  return included;
}

function sameArtifactRef(left: ArtifactRef, right: ArtifactRef): boolean {
  return left.kind === right.kind && left.hash === right.hash && left.path === right.path;
}

function artifactRefsFrom(value: unknown): ArtifactRef[] {
  const refs: ArtifactRef[] = [];
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        visit(item);
      }
      return;
    }
    if (!isRecord(candidate)) {
      return;
    }
    if (isArtifactRef(candidate)) {
      refs.push({
        hash: candidate.hash,
        kind: candidate.kind,
        path: candidate.path,
      });
    }
    for (const entry of Object.values(candidate)) {
      visit(entry);
    }
  };
  visit(value);
  return refs;
}

function isArtifactRef(
  value: Record<string, unknown>,
): value is Record<string, unknown> & ArtifactRef {
  return (
    typeof value["kind"] === "string" &&
    value["kind"].startsWith("bot.") &&
    typeof value["hash"] === "string" &&
    isSha256Ref(value["hash"]) &&
    typeof value["path"] === "string" &&
    isContainedArtifactPath(value["path"])
  );
}

function isSha256Ref(value: string): boolean {
  const prefix = "sha256:";
  const hex = value.slice(prefix.length);
  return value.startsWith(prefix) && hex.length === 64 && isLowerHex(hex);
}

function isLowerHex(value: string): boolean {
  for (const character of value) {
    if (!isLowerHexDigit(character)) {
      return false;
    }
  }
  return true;
}

function isLowerHexDigit(value: string): boolean {
  return isAsciiDigit(value) || (value >= "a" && value <= "f");
}

function isContainedArtifactPath(path: string): boolean {
  if (!path.startsWith("artifacts/") || path.includes("\0")) {
    return false;
  }
  const parts = path.split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}
