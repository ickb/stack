import {
  ProcessSignalError,
  signalExitCode,
  withProcessSignalForwarding,
} from "@ickb/node-utils";
import pathModule from "node:path";
import process from "node:process";
import { runLiveBotStimulusTest } from "../runtime/liveBotStimulusSession.ts";
import { parseArgs, usage } from "./liveBotStimulusArgs.ts";
import { repoRoot } from "./liveBotStimulusConstants.ts";
import type {
  LiveBotStimulusDependencies,
  ParsedStimulusArgs,
  WritableLike,
} from "./liveBotStimulusTypes.ts";
import { publicErrorMessage } from "./liveBotStimulusUtils.ts";
const { join } = pathModule;

type RunStimulusSession = typeof runLiveBotStimulusTest;

interface CadenceOptions {
  io: { stdout?: WritableLike; stderr?: WritableLike };
  receivedSignal: () => "SIGINT" | "SIGTERM" | undefined;
  runSession: RunStimulusSession;
}

/**
 * Runs the live bot stimulus CLI and returns its process exit code.
 *
 * @remarks
 * The command creates tester stimulus for an already-running live bot launcher,
 * then waits for correlated match and quiescence evidence. `io` is injectable
 * for tests.
 */
export async function main(
  argv: string[],
  dependencies: LiveBotStimulusDependencies,
  io: { stdout?: WritableLike; stderr?: WritableLike } = {},
  runSession: RunStimulusSession = runLiveBotStimulusTest,
): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  let args: ParsedStimulusArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    stderr.write(`${publicErrorMessage(error)}\n${usage()}\n`);
    return 1;
  }
  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }
  try {
    const execution = await withProcessSignalForwarding(
      async (signalContext) => {
        const receivedSignal = (): "SIGINT" | "SIGTERM" | undefined =>
          signalContext.signal;
        return args.keepGoing
          ? runLiveBotStimulusCadence(args, dependencies, {
              io,
              runSession,
              receivedSignal,
            })
          : runSession({
              args,
              io,
              dependencies: { ...dependencies, receivedSignal },
            });
      },
      {
        addSignalHandler: dependencies.addSignalHandler,
        removeSignalHandler: dependencies.removeSignalHandler,
      },
    );
    return execution.signal === undefined
      ? execution.value
      : signalExitCode(execution.signal);
  } catch (error) {
    if (error instanceof ProcessSignalError) {
      return signalExitCode(error.signal);
    }
    stderr.write(`Live bot stimulus test failed: ${publicErrorMessage(error)}\n`);
    return 1;
  }
}

async function runLiveBotStimulusCadence(
  args: ParsedStimulusArgs,
  dependencies: LiveBotStimulusDependencies,
  { io, runSession, receivedSignal }: CadenceOptions,
): Promise<number> {
  for (let cycle = 1; ; cycle += 1) {
    const signal = receivedSignal();
    if (signal !== undefined) {
      throw new ProcessSignalError(signal);
    }
    const cycleArgs: ParsedStimulusArgs = {
      ...args,
      sessionRoot: join(
        args.logRoot,
        "validation",
        `live-bot-stimulus-${String(Math.floor((dependencies.now?.() ?? Date.now()) / 1000))}-${String(process.pid)}-cycle-${String(cycle).padStart(4, "0")}`,
      ),
    };
    const status = await runSession({
      args: cycleArgs,
      root: repoRoot,
      dependencies: { ...dependencies, receivedSignal },
      io,
    });
    if (status !== 0) {
      return status;
    }
  }
}
