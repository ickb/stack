import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import fsPromises, { type FileHandle } from "node:fs/promises";
import pathModule from "node:path";
import type { RingDiagnostics, RingSegmentDiagnostics } from "../policy/types.ts";
import { logValue } from "./logValue.ts";

const BOT_ARTIFACT_VERSION = 1;
const noFollow = constants.O_NOFOLLOW;
const readArtifactFlags = constants.O_RDONLY | noFollow;
const writeNewArtifactFlags =
  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow;

/** Content-addressed reference to a bot artifact emitted outside the event line. */
export interface BotArtifactRef {
  /** Artifact kind, for example `bot.ringSegments`. */
  kind: string;

  /** Content hash of the canonical artifact payload. */
  hash: string;

  /** Public reference path built from the configured artifact prefix. */
  path: string;
}

export async function writeBotArtifact(options: {
  artifactRefPrefix: string;
  artifactRoot: string;
  kind: string;
  payload: Record<string, unknown>;
}): Promise<BotArtifactRef> {
  const text = `${canonicalJson({
    version: BOT_ARTIFACT_VERSION,
    kind: options.kind,
    ...options.payload,
  })}\n`;
  const hash = createHash("sha256").update(text).digest("hex");
  const fileName = `sha256-${hash}.json`;
  const kindDir = artifactKindDirectory(options.kind);
  const outputDir = pathModule.join(options.artifactRoot, kindDir);
  await ensureArtifactDirectory(outputDir);
  const path = pathModule.join(outputDir, fileName);
  await writeContentAddressedArtifact(path, text, hash);
  return {
    kind: options.kind,
    hash: `sha256:${hash}`,
    path: `${options.artifactRefPrefix}/${kindDir}/${fileName}`,
  };
}

export function ringSegmentsArtifact(ring: RingDiagnostics): Record<string, unknown> {
  return {
    poolDepositCount: ring.poolDepositCount,
    ringLength: ring.ringLength,
    segmentCount: ring.segmentCount,
    totalPoolUdt: ring.totalPoolUdt,
    depositsShareOneSegment: ring.depositsShareOneSegment,
    segments: ring.segments.map(publicRingSegment),
  };
}

function publicRingSegment({
  index,
  depositCount,
  udtValue,
  protectedDepositCount,
  protectedUdtValue,
  protectedOutPoints,
  surplusDepositCount,
  surplusUdtValue,
  surplusOutPoints,
}: RingSegmentDiagnostics): Omit<RingSegmentDiagnostics, "isTarget"> {
  return {
    index,
    depositCount,
    udtValue,
    protectedDepositCount,
    protectedUdtValue,
    protectedOutPoints,
    surplusDepositCount,
    surplusUdtValue,
    surplusOutPoints,
  };
}

function canonicalJson(value: unknown): string {
  const logged = logValue(value, new Set<unknown>());
  return JSON.stringify(sortJsonValue(logged));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJsonValue(entry)]),
  );
}

function artifactKindDirectory(kind: string): string {
  const scopedKind = kind.startsWith("bot.") ? kind.slice(4) : kind;
  return scopedKind.replaceAll(/[^\w-]/gu, "-");
}

async function ensureArtifactDirectory(outputDir: string): Promise<void> {
  await assertNoSymlinkedArtifactPath(outputDir);
  await fsPromises.mkdir(outputDir, { recursive: true, mode: 0o700 });
  await assertNoSymlinkedArtifactPath(outputDir);
}

async function writeContentAddressedArtifact(
  path: string,
  text: string,
  hash: string,
): Promise<void> {
  const tempPath = `${path}.tmp-${process.pid.toString()}-${Date.now().toString()}-${randomUUID()}`;
  let handle: FileHandle | undefined;
  let tempCreated = false;
  let linkingFinalPath = false;
  try {
    handle = await fsPromises.open(tempPath, writeNewArtifactFlags, 0o600);
    tempCreated = true;
    await handle.writeFile(text, "utf8");
    await handle.chmod(0o600);
    await handle.close();
    handle = undefined;
    linkingFinalPath = true;
    await fsPromises.link(tempPath, path);
  } catch (error) {
    if (linkingFinalPath && isErrno(error, "EEXIST")) {
      await verifyExistingArtifact(path, hash);
    } else {
      throw error;
    }
  } finally {
    await closeArtifactHandle(handle);
    if (tempCreated) {
      await removeTemporaryArtifact(tempPath);
    }
  }
}

async function removeTemporaryArtifact(tempPath: string): Promise<void> {
  try {
    await fsPromises.rm(tempPath, { force: true });
  } catch {
    // Temp cleanup is best-effort; write or verification errors remain authoritative.
  }
}

async function verifyExistingArtifact(path: string, expectedHash: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await fsPromises.open(path, readArtifactFlags);
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new Error(`Artifact path is not a regular file: ${path}`);
    }
    const text = await handle.readFile("utf8");
    const actualHash = createHash("sha256").update(text).digest("hex");
    if (actualHash !== expectedHash) {
      throw new Error(`Existing artifact does not match its content hash: ${path}`);
    }
  } finally {
    await closeArtifactHandle(handle);
  }
}

async function assertNoSymlinkedArtifactPath(path: string): Promise<void> {
  const parsed = pathModule.parse(path);
  let current = parsed.root;
  const parts = pathModule
    .relative(parsed.root, path)
    .split(pathModule.sep)
    .filter(Boolean);
  for (const part of parts) {
    current = pathModule.join(current, part);
    try {
      const stat = await fsPromises.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing symlinked artifact path: ${current}`);
      }
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        return;
      }
      throw error;
    }
  }
}

async function closeArtifactHandle(handle: FileHandle | undefined): Promise<void> {
  if (handle === undefined) {
    return;
  }
  try {
    await handle.close();
  } catch {
    // Preserve the write outcome when close fails after the write attempt.
  }
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
