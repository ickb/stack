import { lstat } from "node:fs/promises";
import path from "node:path";
import { errnoCode } from "./errors.ts";

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
      if (errnoCode(error) === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }
  return undefined;
}
