import { spawnSync } from "node:child_process";
import path from "node:path";

/** Options for {@link runTool}. */
export interface RunToolOptions {
  /** Repository root that owns the `node_modules/.bin` tools. */
  repositoryRoot: string;
  /** Tool name under `node_modules/.bin`. */
  tool: string;
  /** Arguments passed to the tool. */
  toolArguments: string[];
  /** Working directory for the tool run. */
  cwd: string;
  /** Absolute command to run instead of the `node_modules/.bin` tool path. */
  command?: string;
}

/** Result of {@link runTool}. */
export interface ToolResult {
  /** Exit status of the tool, or null when terminated by a signal. */
  status: number | null;
  /** Combined stdout and stderr of the tool run. */
  output: string;
}

/** Runs a workspace-installed CLI tool and captures its combined output. */
export function runTool(options: RunToolOptions): ToolResult {
  const result = spawnSync(
    options.command ??
      path.join(options.repositoryRoot, "node_modules", ".bin", options.tool),
    options.toolArguments,
    { cwd: options.cwd, encoding: "utf8" },
  );
  if (result.error !== undefined) {
    throw result.error;
  }
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}
