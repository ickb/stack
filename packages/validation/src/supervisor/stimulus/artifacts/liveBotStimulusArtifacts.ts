import { appendFile, readFile, writeFile } from "node:fs/promises";
import pathModule from "node:path";
import { SUMMARY_JSON } from "../shared/liveBotStimulusConstants.ts";
import type {
  Dependencies,
  ParsedStimulusArgs,
  SessionPaths,
} from "../shared/liveBotStimulusTypes.ts";
import {
  displayPath,
  isRecord,
  isoNow,
  recordField,
} from "../shared/liveBotStimulusUtils.ts";
const { join } = pathModule;

export async function writeSessionLaunch(
  ...[paths, root, args, dependencies, pid]: [
    paths: SessionPaths,
    root: string,
    args: ParsedStimulusArgs,
    dependencies: Dependencies,
    pid: number,
  ]
): Promise<void> {
  await writeJson(
    paths,
    "supervisor/launch.json",
    {
      app: "live-bot-stimulus-test",
      version: 1,
      startedAt: isoNow(dependencies),
      pid,
      sessionRoot: paths.displaySessionRoot,
      logRoot: displayPath(root, paths.logRoot),
      botEventsPath: paths.displayBotEventsPath,
      options: publicOptions(args),
    },
    dependencies,
  );
  await appendSupervisorEvent(
    paths,
    { type: "session_started", sessionRoot: paths.displaySessionRoot },
    dependencies,
  );
}

export async function writeFinalSummary(
  ...[paths, root, args, result, dependencies]: [
    paths: SessionPaths,
    root: string,
    args: ParsedStimulusArgs,
    result: Record<string, unknown>,
    dependencies: Dependencies,
  ]
): Promise<Record<string, unknown>> {
  const summary = {
    app: "live-bot-stimulus-test",
    version: 1,
    finishedAt: isoNow(dependencies),
    sessionRoot: paths.displaySessionRoot,
    botEventsPath: paths.displayBotEventsPath,
    options: publicOptions(args),
    result,
  };
  await writeJson(paths, SUMMARY_JSON, summary, dependencies);
  await appendSupervisorEvent(
    paths,
    { type: "session_finished", status: result["status"] },
    dependencies,
  );
  return { ...summary, sessionRoot: displayPath(root, paths.sessionRoot) };
}

function publicOptions(args: ParsedStimulusArgs): Record<string, unknown> {
  return {
    logRoot: args.logRoot,
    keepGoing: args.keepGoing,
    sessionRoot: args.sessionRoot ?? null,
    botLiveConfig: args.botLiveConfig,
    testerConfig: args.testerConfig,
    testerScenario: args.testerScenario,
    testerFee: args.testerFee ?? null,
    testerFeeBase: args.testerFeeBase ?? null,
    waitSeconds: args.waitSeconds ?? null,
    pollSeconds: args.pollSeconds,
    commandTimeoutSeconds: args.commandTimeoutSeconds,
    preflightTimeoutSeconds: args.preflightTimeoutSeconds,
  };
}

export async function appendSupervisorEvent(
  paths: SessionPaths,
  record: Record<string, unknown>,
  dependencies: Dependencies,
): Promise<void> {
  const appendFileFn = dependencies.appendFile ?? appendFile;
  await appendFileFn(
    join(paths.supervisorDir, "events.ndjson"),
    `${JSON.stringify({ at: isoNow(dependencies), ...record })}\n`,
    { mode: 0o600 },
  );
}

async function writeJson(
  paths: SessionPaths,
  relativePath: string,
  value: unknown,
  dependencies: Dependencies,
): Promise<void> {
  await writeText(
    paths,
    relativePath,
    `${JSON.stringify(value, null, 2)}\n`,
    dependencies,
  );
}

export async function writeText(
  paths: SessionPaths,
  relativePath: string,
  text: string,
  dependencies: Dependencies,
): Promise<void> {
  const writeFileFn = dependencies.writeFile ?? writeFile;
  await writeFileFn(join(paths.sessionRoot, relativePath), text, {
    mode: 0o600,
  });
}

export async function readJson(
  path: string,
  dependencies: Dependencies,
): Promise<Record<string, unknown>> {
  const text = await readText(path, dependencies);
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) {
    throw new Error(`${path} is not a JSON object`);
  }
  return parsed;
}

export async function readText(
  path: string,
  dependencies: Dependencies,
): Promise<string> {
  const readFileFn = dependencies.readFile ?? readFile;
  return readFileFn(path, "utf8");
}

export function aggregateCounts(
  summary: Record<string, unknown> | undefined,
): Record<string, number> {
  const counts = recordField(summary, "aggregateCounts");
  if (counts === undefined) {
    return {};
  }
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(counts)) {
    if (typeof value === "number" && Number.isSafeInteger(value)) {
      result[key] = value;
    }
  }
  return result;
}
