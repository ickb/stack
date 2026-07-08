import { copyBytes, settleCopies } from "../io.ts";
import { closeSinks } from "../logs.ts";
import { prepareLaunchConfig } from "../storage/prepare.ts";
import { childResultToLauncherResult, failLaunch } from "./process.ts";
import { exitLaunchRecord, startLaunchRecord } from "./records.ts";
import { spawnLaunch } from "./spawn.ts";
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

  try {
    config = await prepareLaunchConfig(parsed, context);
    launch = spawnLaunch(parsed, context, config);
    await config.sinks.launches.writeLine(startLaunchRecord(parsed, launch, context.now));

    const stdoutCopy = copyBytes(
      launch.child.stdout,
      config.sinks.events,
      parsed.teeChildOutput ? context.stdout : undefined,
    );
    const stderrCopy = copyBytes(
      launch.child.stderr,
      config.sinks.stderr,
      parsed.teeChildOutput ? context.stderr : undefined,
    );
    const childResult = await launch.childResultPromise;
    const copyResult = await settleCopies(stdoutCopy, stderrCopy);
    await config.sinks.launches.writeLine(
      exitLaunchRecord({
        childResult,
        copyResult,
        elapsedMs: Date.now() - startTime,
        launch,
        now: context.now,
        parsed,
      }),
    );

    await closeSinks(config.sinks);
    config = undefined;
    launch.removeSignalHandlers();
    return childResultToLauncherResult(childResult, copyResult, context.stderr);
  } catch (error) {
    return failLaunch({
      child: launch?.child,
      error,
      removeSignalHandlers: launch?.removeSignalHandlers,
      sinks: config?.sinks,
      stderr: context.stderr,
    });
  }
}
