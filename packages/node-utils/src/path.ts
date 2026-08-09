import { lstat } from "node:fs/promises";
import path from "node:path";

export interface SymlinkPathDependencies {
  lstat?: (
    path: string,
  ) => { isSymbolicLink: () => boolean } | Promise<{ isSymbolicLink: () => boolean }>;
}

export async function firstSymlinkInPath(
  targetPath: string,
  base = path.parse(targetPath).root,
  dependencies: SymlinkPathDependencies = {},
): Promise<string | undefined> {
  const readLinkStats = dependencies.lstat ?? lstat;
  const parts = path
    .relative(base, targetPath)
    .split(path.sep)
    .filter((part) => part !== "");
  let current = base;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      if ((await readLinkStats(current)).isSymbolicLink()) {
        return current;
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        return undefined;
      }
      throw error;
    }
  }
  return undefined;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
