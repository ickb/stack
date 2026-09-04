import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import pathModule from "node:path";
import { defaultCheckIgnored, type CheckIgnored } from "./git.ts";

const { dirname, isAbsolute, relative, resolve } = pathModule;

export interface ConfigPath {
  absolutePath: string;
  relativePath: string;
}

interface StatLike {
  isSymbolicLink: () => boolean;
}
type MaybePromise<T> = T | Promise<T>;

export interface ConfigFileDependencies {
  link?: (existingPath: string, newPath: string) => MaybePromise<unknown>;
  lstat?: (path: string) => MaybePromise<StatLike>;
  mkdir?: (path: string, options: { mode: number }) => MaybePromise<unknown>;
  realpath?: (path: string) => MaybePromise<string>;
  rename?: (oldPath: string, newPath: string) => MaybePromise<unknown>;
  unlink?: (path: string) => MaybePromise<unknown>;
}

export function outputPath(
  originalRoot: string,
  resolvedRoot: string,
  out: string,
): ConfigPath {
  const absolutePath = isAbsolute(out) ? out : resolve(resolvedRoot, out);
  const relativePath = relative(resolvedRoot, absolutePath);
  if (isInsideRelativePath(relativePath)) {
    return { absolutePath, relativePath };
  }
  if (isAbsolute(out)) {
    const originalRelativePath = relative(originalRoot, out);
    if (isInsideRelativePath(originalRelativePath)) {
      return {
        absolutePath: resolve(resolvedRoot, originalRelativePath),
        relativePath: originalRelativePath,
      };
    }
  }
  throw new Error("Output path must stay inside the repo");
}

export function assertIgnoredPath(
  root: string,
  relativePath: string,
  checkIgnored: CheckIgnored = defaultCheckIgnored,
): void {
  if (!checkIgnored(root, relativePath)) {
    throw new Error(`Refusing to write non-ignored config path: ${relativePath}`);
  }
}

export async function makeSafeParentDir(
  filePath: string,
  root: string,
  dependencies: ConfigFileDependencies,
): Promise<void> {
  const parent = dirname(filePath);
  await assertRealAncestor(root, dependencies);
  const missing = await missingAncestors(parent, dependencies);
  for (const dir of missing.toReversed()) {
    await (dependencies.mkdir ?? mkdir)(dir, { mode: 0o700 });
    await assertRealAncestor(dir, dependencies);
  }
}

async function missingAncestors(
  parent: string,
  dependencies: ConfigFileDependencies,
): Promise<string[]> {
  const missing: string[] = [];
  let current = parent;
  for (;;) {
    try {
      await assertRealAncestor(current, dependencies);
      break;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
      missing.push(current);
      const next = dirname(current);
      if (next === current) {
        throw error;
      }
      current = next;
    }
  }
  return missing;
}

function isInsideRelativePath(relativePath: string): boolean {
  return !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

export function tempConfigPath(filePath: string, kind = "tmp", index?: number): string {
  const suffix = index === undefined ? "" : `-${String(index)}`;
  return `${filePath}.${kind}-${String(process.pid)}-${String(Date.now())}${suffix}`;
}

export async function writeConfigFile(
  filePath: string,
  text: string,
  force: boolean,
  dependencies: ConfigFileDependencies,
): Promise<void> {
  await assertNoSymlinkTarget(filePath, dependencies);
  await assertRealParent(filePath, dependencies);
  const flags =
    constants.O_WRONLY |
    constants.O_CREAT |
    constants.O_NOFOLLOW |
    (force ? constants.O_TRUNC : constants.O_EXCL);
  const handle = await open(filePath, flags, 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
}

export async function cleanupPath(
  filePath: string,
  dependencies: ConfigFileDependencies,
): Promise<void> {
  try {
    await (dependencies.unlink ?? unlink)(filePath);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

export async function assertNoSymlinkTarget(
  filePath: string,
  dependencies: ConfigFileDependencies,
): Promise<void> {
  try {
    const stat = await (dependencies.lstat ?? lstat)(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error("Refusing to write through symlink config path");
    }
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }
    throw error;
  }
}

async function assertRealParent(
  filePath: string,
  dependencies: ConfigFileDependencies,
): Promise<void> {
  const parent = dirname(filePath);
  await assertRealAncestor(parent, dependencies);
  const resolvedParent = await (dependencies.realpath ?? realpath)(parent);
  if (resolvedParent !== parent) {
    throw new Error("Refusing to write config through symlinked parent directory");
  }
}

async function assertRealAncestor(
  filePath: string,
  dependencies: ConfigFileDependencies,
): Promise<void> {
  const stat = await (dependencies.lstat ?? lstat)(filePath);
  if (stat.isSymbolicLink()) {
    throw new Error("Refusing to write config through symlinked parent directory");
  }
}

export function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
