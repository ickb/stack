import { writeFinalSummary } from "../artifacts/liveBotStimulusArtifacts.ts";
import { proveLiveLauncher } from "../preflight/liveBotStimulusPreflight.ts";
import type {
  Dependencies,
  EventFileCursor,
  LauncherProof,
  LiveBotWaitResult,
  ParsedStimulusArgs,
  SessionPaths,
  StimulusChoice,
  StimulusRunResult,
  WritableLike,
} from "../shared/liveBotStimulusTypes.ts";
import { displayPath } from "../shared/liveBotStimulusUtils.ts";
import { testerStimulusSucceeded } from "./liveBotStimulusTesterRun.ts";
import { waitForLiveBotQuiescence, waitSummary } from "./liveBotStimulusWait.ts";

export { eventFileCursor } from "./liveBotStimulusWait.ts";

export async function waitAfterTesterStimulus(
  ...[
    paths,
    root,
    args,
    launcher,
    choice,
    stimulusCursor,
    stimulus,
    dependencies,
    stdout,
    observeWait,
  ]: [
    paths: SessionPaths,
    root: string,
    args: ParsedStimulusArgs,
    launcher: LauncherProof,
    choice: StimulusChoice,
    stimulusCursor: EventFileCursor,
    stimulus: StimulusRunResult,
    dependencies: Dependencies,
    stdout: WritableLike,
    observeWait?: (wait: LiveBotWaitResult) => void,
  ]
): Promise<number> {
  const stimulusOk = testerStimulusSucceeded(stimulus);
  if (!stimulusOk.ok) {
    return stopAfterFailedStimulus(
      paths,
      root,
      args,
      launcher,
      choice,
      stimulus,
      stimulusOk.reason,
      dependencies,
      stdout,
    );
  }
  const wait = await waitForLiveBotQuiescence(
    paths.botEventsPath,
    stimulusCursor,
    args,
    stimulusOk.txHash,
    async () => {
      await proveLiveLauncher(paths, dependencies, launcher);
    },
    dependencies,
    launcher.runId,
  );
  observeWait?.(wait);
  await writeLiveBotWaitSummary(
    paths,
    root,
    args,
    launcher,
    choice,
    stimulusCursor,
    stimulus,
    wait,
    dependencies,
  );
  return reportWaitResult(wait, paths, root, stdout);
}

function reportWaitResult(
  wait: LiveBotWaitResult,
  paths: SessionPaths,
  root: string,
  stdout: WritableLike,
): number {
  if (wait.status === "quiescent") {
    stdout.write(
      `live bot stimulus cycle passed tx=${wait.evidence.txHash} summary=${displayPath(root, paths.summaryPath)}\n`,
    );
    return 0;
  }
  stdout.write(
    `live bot stimulus test failed: ${wait.reason}; summary=${displayPath(root, paths.summaryPath)}\n`,
  );
  return 2;
}

async function writeLiveBotWaitSummary(
  ...[
    paths,
    root,
    args,
    launcher,
    choice,
    stimulusCursor,
    stimulus,
    wait,
    dependencies,
  ]: [
    paths: SessionPaths,
    root: string,
    args: ParsedStimulusArgs,
    launcher: LauncherProof,
    choice: StimulusChoice,
    stimulusCursor: EventFileCursor,
    stimulus: StimulusRunResult,
    wait: LiveBotWaitResult,
    dependencies: Dependencies,
  ]
): Promise<void> {
  await writeFinalSummary(
    paths,
    root,
    args,
    {
      status: wait.status === "quiescent" ? "passed" : "failed",
      launcher,
      stimulusOffset: stimulusCursor.offset,
      choice,
      stimulus,
      wait: waitSummary(wait),
      ...(wait.status === "failed" ? { failure: wait.reason } : {}),
    },
    dependencies,
  );
}

async function stopAfterFailedStimulus(
  ...[paths, root, args, launcher, choice, stimulus, failure, dependencies, stdout]: [
    paths: SessionPaths,
    root: string,
    args: ParsedStimulusArgs,
    launcher: LauncherProof,
    choice: StimulusChoice,
    stimulus: StimulusRunResult,
    failure: string,
    dependencies: Dependencies,
    stdout: WritableLike,
  ]
): Promise<number> {
  await writeFinalSummary(
    paths,
    root,
    args,
    {
      status: "failed",
      launcher,
      choice,
      stimulus,
      failure,
    },
    dependencies,
  );
  stdout.write(
    `live bot stimulus test failed: ${failure}; summary=${displayPath(root, paths.summaryPath)}\n`,
  );
  return 2;
}
