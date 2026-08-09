import {
  ProcessSignalError,
  readLinuxProcessIdentity,
  runProcess,
} from "@ickb/node-utils";
import { open, stat } from "node:fs/promises";
import process from "node:process";
import { boundedText } from "../../runtime/shared/supervisorEvidence.ts";
import { readText } from "../artifacts/liveBotStimulusArtifacts.ts";
import {
  LAUNCHER_STARTED_EVENT,
  MAX_EVENT_READ_BYTES,
} from "../shared/liveBotStimulusConstants.ts";
import type {
  Dependencies,
  LauncherIdentity,
  LauncherProcessIdentity,
  LauncherProof,
  SessionPaths,
} from "../shared/liveBotStimulusTypes.ts";
import {
  assertContained,
  findLastIndex,
  isRecord,
  minimalProcessEnv,
  numberField,
  optionalStringField,
  publicErrorMessage,
  recordField,
  resolveConfiguredPath,
  stringField,
} from "../shared/liveBotStimulusUtils.ts";

export async function runPreflight(
  ...[root, configPath, role, timeoutSeconds, dependencies]: [
    root: string,
    configPath: string,
    role: string,
    timeoutSeconds: number,
    dependencies: Dependencies,
  ]
): Promise<Record<string, unknown>> {
  const result = await (dependencies.runProcess ?? runProcess)(
    process.execPath,
    ["scripts/live/preflight.ts", "--config", configPath],
    {
      cwd: root,
      detached: true,
      env: minimalProcessEnv(process.env),
      timeoutMs: timeoutSeconds * 1000,
    },
  );
  if (result.forwardedSignal !== undefined) {
    throw new ProcessSignalError(result.forwardedSignal);
  }
  if (result.error !== undefined) {
    throw new Error(`preflight ${role} failed: ${publicErrorMessage(result.error)}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `preflight ${role} exited with status ${String(result.status)}: ${boundedText(result.stderr, 240)}`,
    );
  }
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    // Fall through to the public error below.
  }
  throw new Error(`preflight ${role} returned invalid JSON`);
}

/**
 * Proves the latest live bot launcher and child process are still running.
 *
 * @remarks
 * The proof is based on launcher NDJSON records plus process liveness checks.
 */
export async function proveLiveLauncher(
  paths: SessionPaths,
  dependencies: Dependencies,
  expected?: LauncherProof,
): Promise<LauncherProof> {
  const text = await boundedLaunchTail(paths.launchesPath, dependencies);
  const records = text.split(/\r?\n/u).flatMap((line): Array<Record<string, unknown>> => {
    if (line.trim() === "") {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(line);
      return isRecord(parsed) ? [parsed] : [];
    } catch {
      return [];
    }
  });
  const latestStartIndex = findLastIndex(
    records,
    (record) => record["type"] === LAUNCHER_STARTED_EVENT,
  );
  if (latestStartIndex < 0) {
    throw new Error(`live bot launcher has no ${LAUNCHER_STARTED_EVENT} record`);
  }
  const latestStart: Record<string, unknown> = Object.assign(
    {},
    records[latestStartIndex],
  );
  const pid = numberField(latestStart, "pid");
  const childPid = numberField(latestStart, "childPid");
  if (pid === undefined || pid <= 0 || childPid === undefined || childPid <= 0) {
    throw new Error("live bot launcher start record lacks pid or childPid");
  }
  const identity = launcherIdentity(latestStart, pid, childPid);
  const runId = stringField(latestStart, "runId");
  if (runId === undefined || !/^[\w.:-]{1,128}$/u.test(runId)) {
    throw new Error("live bot launcher start record lacks a valid runId");
  }
  if (
    expected !== undefined &&
    (runId !== expected.runId || !sameLauncherIdentity(identity, expected.identity))
  ) {
    throw new Error("live bot launcher identity changed since initial proof");
  }
  const exited = records
    .slice(latestStartIndex + 1)
    .some(
      (record) =>
        record["pid"] === pid &&
        (record["type"] === "launcher.child.exited" ||
          record["type"] === "launcher.io.failed"),
    );
  if (exited) {
    throw new Error("latest live bot launcher record has already exited");
  }
  const readProcessIdentity =
    dependencies.readProcessIdentity ?? readLinuxProcessIdentity;
  await proveProcessIdentity(
    "launcher",
    identity.bootId,
    identity.launcher,
    readProcessIdentity,
  );
  await proveProcessIdentity(
    "child",
    identity.bootId,
    identity.child,
    readProcessIdentity,
  );
  return {
    pid,
    childPid,
    runId,
    identity,
    ...optionalStringField(latestStart, "timestamp"),
    ...optionalStringField(latestStart, "logDir"),
    ...launcherBotEventsPath(paths, latestStart),
  };
}

async function boundedLaunchTail(
  filePath: string,
  dependencies: Dependencies,
): Promise<string> {
  if (dependencies.readFile !== undefined) {
    const text = await readText(filePath, dependencies);
    return Buffer.byteLength(text) <= MAX_EVENT_READ_BYTES
      ? text
      : Buffer.from(text).subarray(-MAX_EVENT_READ_BYTES).toString("utf8");
  }
  const stats = await (dependencies.stat ?? stat)(filePath);
  const length = Math.min(stats.size, MAX_EVENT_READ_BYTES);
  const handle = await (dependencies.open ?? open)(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const start = stats.size - length;
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    return start === 0 ? text : text.split(/\r?\n/u).slice(1).join("\n");
  } finally {
    await handle.close();
  }
}

function launcherIdentity(
  record: Record<string, unknown>,
  pid: number,
  childPid: number,
): LauncherIdentity {
  if (record["version"] !== 3) {
    throw new Error(
      "live bot launcher start record uses a legacy schema; restart the launcher",
    );
  }
  const identity = recordField(record, "identity");
  const bootId = stringField(identity, "bootId")?.trim();
  const launcher = launcherProcessIdentity(recordField(identity, "launcher"), pid);
  const child = launcherProcessIdentity(recordField(identity, "child"), childPid);
  if (
    bootId === undefined ||
    bootId === "" ||
    launcher === undefined ||
    child === undefined
  ) {
    throw new Error("live bot launcher start record has malformed process identity");
  }
  return { bootId, launcher, child };
}

function launcherProcessIdentity(
  record: Record<string, unknown> | undefined,
  expectedPid: number,
): LauncherProcessIdentity | undefined {
  const pid = numberField(record, "pid");
  const startTimeTicks = stringField(record, "startTimeTicks");
  return pid === expectedPid &&
    startTimeTicks !== undefined &&
    /^[1-9]\d*$/u.test(startTimeTicks)
    ? { pid, startTimeTicks }
    : undefined;
}

async function proveProcessIdentity(
  role: "launcher" | "child",
  bootId: string,
  expected: LauncherProcessIdentity,
  readIdentity: typeof readLinuxProcessIdentity,
): Promise<void> {
  let actual: Awaited<ReturnType<typeof readLinuxProcessIdentity>>;
  try {
    actual = await readIdentity(expected.pid);
  } catch (error) {
    throw new Error(`live bot ${role} process is not running: ${String(expected.pid)}`, {
      cause: error,
    });
  }
  if (actual.bootId !== bootId) {
    throw new Error(
      `live bot ${role} process boot identity does not match launch record`,
    );
  }
  if (actual.startTimeTicks !== expected.startTimeTicks) {
    throw new Error(`live bot ${role} process start time does not match launch record`);
  }
}

function sameLauncherIdentity(left: LauncherIdentity, right: LauncherIdentity): boolean {
  return (
    left.bootId === right.bootId &&
    left.launcher.pid === right.launcher.pid &&
    left.launcher.startTimeTicks === right.launcher.startTimeTicks &&
    left.child.pid === right.child.pid &&
    left.child.startTimeTicks === right.child.startTimeTicks
  );
}

function launcherBotEventsPath(
  paths: SessionPaths,
  latestStart: Record<string, unknown>,
): { botEventsPath?: string } {
  const logFiles = recordField(latestStart, "logFiles");
  const events = stringField(logFiles, "events");
  if (events === undefined) {
    return {};
  }
  const resolved = resolveConfiguredPath(
    events,
    paths.botLogDir,
    "launcher events log path",
  );
  assertContained(paths.botLogDir, resolved, "launcher events log path");
  return { botEventsPath: resolved };
}
