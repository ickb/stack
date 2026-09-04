import {
  errorMessage,
  signalExitCode,
  withProcessSignalForwarding,
} from "@ickb/node-utils";
import process from "node:process";
import { processRunnerDependencies } from "../runtime/command/supervisorCommandRun.ts";
import { repoRoot } from "../runtime/shared/supervisorConstants.ts";
import { supervise } from "../runtime/shared/supervisorMainRun.ts";
import type {
  ParsedArgs,
  SupervisorDependencies,
} from "../runtime/shared/supervisorTypes.ts";
import { parseArgs, usage } from "./supervisorArgs.ts";
import { resolvePlan } from "./supervisorPaths.ts";

/**
 * Runs the live supervisor CLI and returns its process exit code.
 *
 * @remarks
 * `io` and `dependencies` isolate process execution and signal forwarding from
 * the host process in tests.
 */
export async function main(
  argv: string[],
  dependencies: SupervisorDependencies,
  io: {
    stdout?: Pick<NodeJS.WritableStream, "write">;
    stderr?: Pick<NodeJS.WritableStream, "write">;
  } = {},
): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    stderr.write(`${errorMessage(error)}\n${usage()}\n`);
    return 1;
  }
  if (parsed.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }

  try {
    const plan = resolvePlan(parsed, repoRoot, dependencies);
    const execution = await withProcessSignalForwarding(
      async (processSignalContext) =>
        supervise(parsed, plan, { ...dependencies, processSignalContext }),
      processRunnerDependencies(dependencies),
      dependencies.commandKillGraceMs,
    );
    if (execution.signal !== undefined) {
      return signalExitCode(execution.signal);
    }
    stdout.write(`live supervisor artifacts: ${plan.relativeOutDir}\n`);
    return execution.value;
  } catch (error) {
    stderr.write(`Live supervisor failed: ${errorMessage(error)}\n`);
    return 1;
  }
}
