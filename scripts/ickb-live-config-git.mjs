import { spawnSync } from "node:child_process";

export function defaultCheckIgnored(root, relativePath, spawnSyncFn = spawnSync) {
  const result = spawnSyncFn("git", ["-C", root, "check-ignore", "--", relativePath], {
    encoding: "utf8",
  });
  if (result.error !== undefined) {
    throw new Error("Failed to run git check-ignore", { cause: result.error });
  }
  if (result.status === 0) {
    return true;
  }
  if (result.status === 1) {
    return false;
  }
  const stderr = result.stderr === undefined ? "" : String(result.stderr).trim();
  throw new Error(stderr === "" ? "Failed to run git check-ignore" : `Failed to run git check-ignore: ${stderr}`);
}
