import { copyBotEvents, copyBytes, settleCopies } from "../io.ts";
import { closeSinks } from "../logs.ts";
import { prepareLaunchConfig } from "../storage/prepare.ts";
import {
  childResultToLauncherResult,
  failLaunch,
  releaseLauncherLock,
} from "./process.ts";
import { exitLaunchRecord, startLaunchRecord, writeLaunchRecord } from "./records.ts";
import { captureLaunchIdentity, spawnLaunch } from "./spawn.ts";
import type {
  LauncherContext,
  LauncherResult,
  ParsedLauncherArgs,
  PreparedLaunch,
  PreparedLaunchConfig,
} from "./types.ts";

export async function runParsedBotLauncher(
  parsed: Exclude<ParsedLauncherArgs, { help: true }>,
  context: LauncherContext,
  startTime: number,
): Promise<LauncherResult> {
  let launch: PreparedLaunch | undefined;
  let config: PreparedLaunchConfig | undefined;
  let startWritten = false;
  let terminalWritten = false;

  try {
    config = await prepareLaunchConfig(parsed, context);
    launch = spawnLaunch(parsed, context, config);
    launch.identity = await captureLaunchIdentity(launch.child, context);
    await writeLaunchRecord(
      config.sinks.launches,
      startLaunchRecord(parsed, launch, context.now),
    );
    startWritten = true;

    const stdoutCopy = copyBotEvents(
      launch.child.stdout,
      config.sinks.events,
      parsed.teeChildOutput ? context.stdout : undefined,
    );
    const stderrCopy = copyBytes(
      launch.child.stderr,
      config.sinks.stderr,
      parsed.teeChildOutput ? context.stderr : undefined,
    );
    const { childResultPromise } = launch;
    const childResult = await Promise.race([
      childResultPromise,
      childAfterCopy(stdoutCopy, childResultPromise),
      childAfterCopy(stderrCopy, childResultPromise),
    ]);
    const copyResult = await settleCopies(stdoutCopy, stderrCopy);
    await writeLaunchRecord(
      config.sinks.launches,
      exitLaunchRecord({
        childResult,
        copyResult,
        elapsedMs: Date.now() - startTime,
        launch,
        now: context.now,
        parsed,
      }),
    );
    terminalWritten = true;

    await closeSinks(config.sinks);
    launch.removeSignalHandlers();
    const { lock } = config;
    config = undefined;
    await releaseLauncherLock(lock);
    return childResultToLauncherResult(childResult, copyResult, context.stderr);
  } catch (error) {
    const failedLaunch = launch;
    const failedConfig = config;
    return failLaunch({
      beforeClose: terminalEvidenceWriter({
        config: failedConfig,
        context,
        error,
        launch: failedLaunch,
        parsed,
        startTime,
        startWritten,
        terminalWritten,
      }),
      child: failedLaunch?.child,
      childClosePromise: failedLaunch?.childClosePromise,
      error,
      lock: failedConfig?.lock,
      removeSignalHandlers: failedLaunch?.removeSignalHandlers,
      sinks: failedConfig?.sinks,
      stderr: context.stderr,
    });
  }
}

function terminalEvidenceWriter(context: {
  config?: PreparedLaunchConfig;
  context: LauncherContext;
  error: unknown;
  launch?: PreparedLaunch;
  parsed: Exclude<ParsedLauncherArgs, { help: true }>;
  startTime: number;
  startWritten: boolean;
  terminalWritten: boolean;
}): (() => Promise<void>) | undefined {
  const { config, launch, startWritten, terminalWritten } = context;
  if (config === undefined || launch === undefined || !startWritten || terminalWritten) {
    return undefined;
  }
  return async (): Promise<void> => {
    const childResult = await launch.childResultPromise;
    await writeLaunchRecord(
      config.sinks.launches,
      exitLaunchRecord({
        childResult,
        copyResult: context.error,
        elapsedMs: Date.now() - context.startTime,
        launch,
        now: context.context.now,
        parsed: context.parsed,
      }),
    );
  };
}

async function childAfterCopy<T>(
  copy: Promise<void>,
  childResult: Promise<T>,
): Promise<T> {
  await copy;
  return childResult;
}
