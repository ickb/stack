import { lstat } from "node:fs/promises";
import path from "node:path";
import { errnoCode } from "./errors.ts";

export async function firstSymlinkInPath(
  targetPath: string,
  base = path.parse(targetPath).root,
): Promise<string | undefined> {
  const parts = path
    .relative(base, targetPath)
    .split(path.sep)
    .filter((part) => part !== "");
  let current = base;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Walks the caller's already-validated path component by component to find the first symlink.
      if ((await lstat(current)).isSymbolicLink()) {
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
