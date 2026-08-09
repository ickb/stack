import { ProcessSignalError } from "@ickb/node-utils";
import process from "node:process";
import {
  aggregateCounts,
  appendSupervisorEvent,
  writeFinalSummary,
  writeSessionLaunch,
} from "../artifacts/liveBotStimulusArtifacts.ts";
import {
  prepareSession,
  resolveSessionPaths,
} from "../artifacts/liveBotStimulusPaths.ts";
import { prepareLiveBotStimulusSession } from "../preflight/liveBotStimulusPrepare.ts";
import { repoRoot } from "../shared/liveBotStimulusConstants.ts";
import type {
  LiveBotStimulusDependencies,
  ParsedStimulusArgs,
  WritableLike,
} from "../shared/liveBotStimulusTypes.ts";
import { displayPath, publicErrorMessage } from "../shared/liveBotStimulusUtils.ts";
import { runTesterStimulus } from "./liveBotStimulusTesterRun.ts";
import { waitSummary } from "./liveBotStimulusWait.ts";
import { eventFileCursor, waitAfterTesterStimulus } from "./liveBotStimulusWaitAfter.ts";

/**
 * Runs one live bot stimulus validation session.
 *
 * @remarks
 * The session writes launch and summary artifacts, creates one tester stimulus,
 * and waits for already-running live bot match and quiescence evidence.
 */
export async function runLiveBotStimulusTest({
  args,
  root = repoRoot,
  dependencies,
  io = {},
}: {
  args: ParsedStimulusArgs;
  root?: string;
  dependencies: LiveBotStimulusDependencies;
  io?: { stdout?: WritableLike; stderr?: WritableLike };
}): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const paths = resolveSessionPaths(args, root, dependencies);
  const evidence: Record<string, unknown> = {};
  let sessionPrepared = false;
  let launchWritten = false;
  stdout.write(`live bot stimulus cycle starting session=${paths.displaySessionRoot}\n`);

  try {
    await prepareSession(paths, dependencies);
    sessionPrepared = true;
    const prepared = await prepareLiveBotStimulusSession(paths, {
      root,
      args,
      dependencies,
      observeLauncher: (launcher) => {
        Object.assign(evidence, { launcher });
      },
    });
    Object.assign(evidence, { choice: prepared.choice });
    await writeSessionLaunch(paths, root, args, dependencies, process.pid);
    launchWritten = true;
    const stimulusCursor = await eventFileCursor(
      prepared.paths.botEventsPath,
      dependencies,
    );
    const stimulus = await runTesterStimulus(
      root,
      args,
      prepared.paths,
      prepared.choice,
      prepared.launcher,
      dependencies,
    );
    Object.assign(evidence, { stimulus });
    await recordStimulusFinished(prepared.paths, root, stimulus, dependencies);
    return await waitAfterTesterStimulus(
      prepared.paths,
      root,
      args,
      prepared.launcher,
      prepared.choice,
      stimulusCursor,
      stimulus,
      dependencies,
      stdout,
      (wait) => {
        Object.assign(evidence, { wait: waitSummary(wait) });
      },
    );
  } catch (error) {
    await reportExceptionalSession({
      error,
      paths,
      root,
      args,
      dependencies,
      stdout,
      evidence,
      sessionPrepared,
      launchWritten,
    });
    throw error;
  }
}

async function recordStimulusFinished(
  paths: ReturnType<typeof resolveSessionPaths>,
  root: string,
  stimulus: Awaited<ReturnType<typeof runTesterStimulus>>,
  dependencies: LiveBotStimulusDependencies,
): Promise<void> {
  await appendSupervisorEvent(
    paths,
    {
      type: "stimulus_finished",
      status: stimulus.status,
      outDir: displayPath(root, stimulus.outDir),
      summaryPath: displayPath(root, stimulus.summaryPath),
      outcomes: aggregateCounts(stimulus.summary),
    },
    dependencies,
  );
}

async function reportExceptionalSession(context: {
  error: unknown;
  paths: ReturnType<typeof resolveSessionPaths>;
  root: string;
  args: ParsedStimulusArgs;
  dependencies: LiveBotStimulusDependencies;
  stdout: WritableLike;
  evidence: Record<string, unknown>;
  sessionPrepared: boolean;
  launchWritten: boolean;
}): Promise<void> {
  const { error, paths, root, args, dependencies, stdout, evidence } = context;
  const status = error instanceof ProcessSignalError ? "interrupted" : "failed";
  if (context.sessionPrepared && !context.launchWritten) {
    try {
      await writeSessionLaunch(paths, root, args, dependencies, process.pid);
    } catch {
      // The final summary below remains the authoritative best-effort artifact.
    }
  }
  let summaryWritten = false;
  try {
    await writeFinalSummary(
      paths,
      root,
      args,
      { status, failure: publicErrorMessage(error), ...evidence },
      dependencies,
    );
    summaryWritten = true;
  } catch {
    // Preserve the original failure when the best-effort summary write fails.
  }
  stdout.write(
    `live bot stimulus cycle ${status} summary=${summaryWritten ? displayPath(root, paths.summaryPath) : "unavailable"}\n`,
  );
}
