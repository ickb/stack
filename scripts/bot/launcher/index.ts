import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parseArgs, usage } from "./args.ts";
import { runParsedBotLauncher } from "./runtime/execute.ts";
import { publicErrorMessage } from "./runtime/support.ts";
import type {
  LauncherContext,
  LauncherResult,
  ParsedLauncherArgs,
  RunBotLauncherOptions,
} from "./runtime/types.ts";

const rootDir = fileURLToPath(new URL("../../..", import.meta.url));

export { copyBytes } from "./io.ts";
export { LogSink, selectRunLogs } from "./logs.ts";
export { resolveLauncherPaths } from "./paths.ts";
export { parseArgs, usage };

export async function runBotLauncher({
  argv = process.argv.slice(2),
  env = process.env,
  now = (): Date => new Date(),
  root = rootDir,
  spawnProcess = spawn,
  stderr = process.stderr,
  stdout = process.stdout,
}: RunBotLauncherOptions = {}): Promise<LauncherResult> {
  const context = { env, now, root, spawnProcess, stderr, stdout };
  const startTime = Date.now();
  const parsed = parseLauncherInvocation(argv, stdout, stderr);
  if (parsed === undefined || parsed.help === true) {
    return parsed === undefined ? { status: 1 } : { status: 0 };
  }

  return runParsedBotLauncher(parsed, context, startTime);
}

function parseLauncherInvocation(
  argv: readonly string[],
  stdout: LauncherContext["stdout"],
  stderr: LauncherContext["stderr"],
): ParsedLauncherArgs | undefined {
  try {
    const parsed = parseArgs(argv);
    if (parsed.help === true) {
      stdout.write(usage());
    }
    return parsed;
  } catch (error) {
    stderr.write(`ickb-bot-launcher: ${publicErrorMessage(error)}\n${usage()}`);
    return undefined;
  }
}
