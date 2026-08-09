import { spawnSync } from "node:child_process";
import { minimalProcessEnv } from "../../../packages/node-utils/src/index.ts";

type CheckIgnoredSpawnSync = (
  command: string,
  args: readonly string[],
  options: { encoding: "utf8"; env: Record<string, string> },
) => { error?: Error; status: number | null; stderr?: unknown };

export type CheckIgnored = (root: string, relativePath: string) => boolean;

export function defaultCheckIgnored(
  root: string,
  relativePath: string,
  spawnSyncFn: CheckIgnoredSpawnSync = spawnSync,
): boolean {
  const result = spawnSyncFn("git", ["-C", root, "check-ignore", "--", relativePath], {
    encoding: "utf8",
    env: minimalProcessEnv(process.env),
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
  const stderr = spawnOutputText(result.stderr);
  throw new Error(
    stderr === ""
      ? "Failed to run git check-ignore"
      : `Failed to run git check-ignore: ${stderr}`,
  );
}

function spawnOutputText(output: unknown): string {
  if (typeof output === "string") {
    return output.trim();
  }
  if (output instanceof Uint8Array) {
    return Buffer.from(output).toString("utf8").trim();
  }
  return "";
}
