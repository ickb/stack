import { jsonLogReplacer } from "../../../packages/node-utils/src/index.ts";
import { parseArgs, type PreflightArgs, usage } from "./args.ts";
import { publicErrorMessage } from "./errors.ts";
import { runPreflight } from "./run.ts";

interface WritableLike {
  write: (chunk: string) => unknown;
}

interface PreflightIo {
  stderr?: WritableLike;
  stdout?: WritableLike;
}

export async function main(
  argv: readonly string[],
  io: PreflightIo = {},
): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  let args: PreflightArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    stderr.write(`${publicErrorMessage(error)}\n${usage()}\n`);
    return 1;
  }
  if (args.help === true) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  try {
    const report = await runPreflight(args);
    stdout.write(`${JSON.stringify(report, jsonLogReplacer, 2)}\n`);
    return 0;
  } catch (error) {
    const label =
      error instanceof Error && error.name === "RetryablePreflightError"
        ? "Live preflight retryable failure"
        : "Live preflight failed";
    stderr.write(`${label}: ${publicErrorMessage(error)}\n`);
    return 1;
  }
}
