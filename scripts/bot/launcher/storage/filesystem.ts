import type { Dirent, Stats } from "node:fs";
import {
  lstat as fsLstat,
  mkdir as fsMkdir,
  open as fsOpen,
  readdir as fsReaddir,
  readFile as fsReadFile,
  realpath as fsRealpath,
  rm as fsRm,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";

import { logDirectoryLabel } from "../runtime/constants.ts";
import { isErrorCode } from "../runtime/support.ts";

export async function prepareLogPaths(paths: {
  logDir: string;
  logRoot: string;
}): Promise<void> {
  await prepareLogDirectory(paths.logRoot);
  await prepareLogDirectory(paths.logDir);
  await proveResolvedPath(paths.logRoot, "log root");
  await proveResolvedPath(paths.logDir, logDirectoryLabel);
}

export async function prepareLogDirectory(directory: string): Promise<void> {
  const parsed = path.parse(directory);
  let current = parsed.root;
  await assertDirectory(current);

  const parts = path.relative(parsed.root, directory).split(path.sep).filter(Boolean);
  for (const part of parts) {
    current = path.join(current, part);
    await ensureLogDirectoryPart(current);
  }
}

export async function resetArtifactDirectory(filePath: string): Promise<void> {
  try {
    const stat = await safeLstat(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing symlinked artifact directory path: ${filePath}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`Artifact path is not a directory: ${filePath}`);
    }
    await safeRm(filePath, { force: true, recursive: true });
  } catch (error) {
    if (!isErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
  await safeMkdir(filePath, { recursive: true, mode: 0o700 });
  await assertDirectory(filePath);
}

export async function safeLstat(filePath: string): Promise<Stats> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Callers prove launcher-managed paths before filesystem use.
  return fsLstat(filePath);
}

export async function safeMkdir(
  directory: string,
  options: Parameters<typeof fsMkdir>[1],
): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Callers build paths from the resolved log root and checked path parts.
  await fsMkdir(directory, options);
}

export async function safeRealpath(filePath: string): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This is the symlink proof for the already resolved launcher path.
  return fsRealpath(filePath);
}

export async function safeRm(
  filePath: string,
  options: Parameters<typeof fsRm>[1],
): Promise<void> {
  await fsRm(filePath, options);
}

export async function safeReaddir(
  directory: string,
  options: { withFileTypes: true },
): Promise<Dirent[]> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Directory reads stay under checked launcher log/artifact paths.
  return fsReaddir(directory, options);
}

export async function safeReadFile(
  filePath: string,
  encoding: BufferEncoding,
): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Reads target checked launcher log files or package metadata.
  return fsReadFile(filePath, encoding);
}

export async function safeOpen(
  filePath: string,
  flags: number,
  mode: number,
): Promise<FileHandle> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Opens checked log files with no-follow flags and post-open file validation.
  return fsOpen(filePath, flags, mode);
}

async function ensureLogDirectoryPart(current: string): Promise<void> {
  try {
    await assertDirectory(current);
  } catch (error) {
    if (!isErrorCode(error, "ENOENT")) {
      throw error;
    }
    await safeMkdir(current, { mode: 0o700 });
    await assertDirectory(current);
  }
}

async function assertDirectory(filePath: string): Promise<void> {
  const stat = await safeLstat(filePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing symlinked log directory path: ${filePath}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Log directory path is not a directory: ${filePath}`);
  }
}

async function proveResolvedPath(filePath: string, label: string): Promise<void> {
  const real = await safeRealpath(filePath);
  if (real !== filePath) {
    throw new Error(`Resolved ${label} crosses a symlink`);
  }
}
