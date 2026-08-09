import { open, stat } from "node:fs/promises";
import {
  appendSupervisorEvent,
  readText,
} from "../artifacts/liveBotStimulusArtifacts.ts";
import {
  assertUnboundedBotLivePreflight,
  balancesFromPreflight,
  chooseLiveBotStimulus,
} from "../selection/liveBotStimulusSelection.ts";
import {
  BOT_CHAIN_PREFLIGHT_EVENT,
  MAX_EVENT_READ_BYTES,
} from "../shared/liveBotStimulusConstants.ts";
import type {
  Dependencies,
  LauncherProof,
  ParsedStimulusArgs,
  PublicLiveBotIdentity,
  SessionPaths,
  StimulusChoice,
} from "../shared/liveBotStimulusTypes.ts";
import {
  displayPath,
  isRecord,
  numberField,
  recordField,
  stringField,
} from "../shared/liveBotStimulusUtils.ts";
import { proveLiveLauncher, runPreflight } from "./liveBotStimulusPreflight.ts";

const MALFORMED_PUBLIC_IDENTITY = "live bot public identity is malformed";

export async function prepareLiveBotStimulusSession(
  paths: SessionPaths,
  context: {
    root: string;
    args: ParsedStimulusArgs;
    dependencies: Dependencies;
    observeLauncher?: (launcher: LauncherProof) => void;
  },
): Promise<{ launcher: LauncherProof; choice: StimulusChoice; paths: SessionPaths }> {
  const { root, dependencies, observeLauncher } = context;
  const launcher = await proveLiveLauncher(paths, dependencies);
  if (launcher.botEventsPath !== undefined) {
    Object.assign(paths, {
      botEventsPath: launcher.botEventsPath,
      displayBotEventsPath: displayPath(root, launcher.botEventsPath),
    });
  }
  const activePaths = paths;
  observeLauncher?.(launcher);
  await appendSupervisorEvent(
    activePaths,
    { type: "launcher_alive", launcher },
    dependencies,
  );
  const choice = await selectLiveBotStimulus(activePaths, launcher, context);
  await appendSupervisorEvent(
    activePaths,
    { type: "stimulus_selected", choice },
    dependencies,
  );
  return { launcher, choice, paths: activePaths };
}

async function selectLiveBotStimulus(
  paths: SessionPaths,
  launcher: LauncherProof,
  context: { root: string; args: ParsedStimulusArgs; dependencies: Dependencies },
): Promise<StimulusChoice> {
  const { root, args, dependencies } = context;
  const botPreflight = await runPreflight(
    root,
    args.botLiveConfig,
    "bot-live-stimulus-test",
    args.preflightTimeoutSeconds,
    dependencies,
  );
  assertUnboundedBotLivePreflight(botPreflight);
  await proveLiveBotPublicIdentity(paths, launcher, botPreflight, dependencies);
  const testerPreflight = await runPreflight(
    root,
    args.testerConfig,
    "tester-stimulus-test",
    args.preflightTimeoutSeconds,
    dependencies,
  );
  assertNoMatchableTesterOrders(testerPreflight);
  return chooseLiveBotStimulus({
    tester: balancesFromPreflight(testerPreflight),
    requestedScenario: args.testerScenario,
    testerFee: args.testerFee,
    testerFeeBase: args.testerFeeBase,
  });
}

async function proveLiveBotPublicIdentity(
  paths: SessionPaths,
  launcher: LauncherProof,
  report: Record<string, unknown>,
  dependencies: Dependencies,
): Promise<void> {
  const text = await boundedEventPrefix(paths.botEventsPath, dependencies);
  const observed = text.split(/\r?\n/u).flatMap((line) => {
    const identity = identityFromEventLine(line, launcher.runId);
    return identity === undefined ? [] : [identity];
  });
  if (observed.length === 0) {
    throw new Error(
      "live bot event log lacks canonical preflight identity for launcher runId",
    );
  }
  if (observed.length !== 1) {
    throw new Error(
      "live bot event log has duplicate canonical preflight identity events",
    );
  }
  const expected = publicLiveBotIdentityFromPreflight(report);
  if (JSON.stringify(observed[0]) !== JSON.stringify(expected)) {
    throw new Error("live bot runtime identity does not match bot config preflight");
  }
}

async function boundedEventPrefix(
  filePath: string,
  dependencies: Dependencies,
): Promise<string> {
  if (dependencies.readFile !== undefined) {
    const text = await readText(filePath, dependencies);
    return Buffer.byteLength(text) <= MAX_EVENT_READ_BYTES
      ? text
      : Buffer.from(text).subarray(0, MAX_EVENT_READ_BYTES).toString("utf8");
  }
  const stats = await (dependencies.stat ?? stat)(filePath);
  const length = Math.min(stats.size, MAX_EVENT_READ_BYTES);
  const handle = await (dependencies.open ?? open)(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

function identityFromEventLine(
  line: string,
  runId: string,
): PublicLiveBotIdentity | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (
    !isRecord(parsed) ||
    parsed["app"] !== "bot" ||
    parsed["type"] !== BOT_CHAIN_PREFLIGHT_EVENT ||
    parsed["runId"] !== runId
  ) {
    return undefined;
  }
  const identity = parsePublicLiveBotIdentity(recordField(parsed, "identity"));
  const matches = recordField(parsed, "matches");
  if (
    parsed["version"] !== 1 ||
    parsed["iterationId"] !== 0 ||
    parsed["chain"] !== identity.chain ||
    matches?.["genesisHash"] !== true ||
    matches["addressPrefix"] !== true ||
    stringField(parsed, "timestamp") === undefined
  ) {
    throw new TypeError(MALFORMED_PUBLIC_IDENTITY);
  }
  return identity;
}

function publicLiveBotIdentityFromPreflight(
  report: Record<string, unknown>,
): PublicLiveBotIdentity {
  const sleepIntervalMs = millisecondsFromSeconds(report["sleepIntervalSeconds"]);
  return parsePublicLiveBotIdentity({
    chain: report["chain"],
    primaryLock: recordField(report, "key")?.["primaryLock"],
    bounded: report["bounded"],
    ...(report["maxRetryableAttempts"] === undefined
      ? {}
      : { maxRetryableAttempts: report["maxRetryableAttempts"] }),
    sleepIntervalMs,
    rpcEndpoint: report["rpcEndpoint"],
  });
}

function millisecondsFromSeconds(value: unknown): number | undefined {
  if (typeof value !== "number" || value < 0) {
    return undefined;
  }
  const milliseconds = value * 1000;
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
}

function parsePublicLiveBotIdentity(
  value: Record<string, unknown> | undefined,
): PublicLiveBotIdentity {
  assertExactKeys(value, [
    "chain",
    "primaryLock",
    "bounded",
    "maxIterations",
    "maxRetryableAttempts",
    "sleepIntervalMs",
    "rpcEndpoint",
  ]);
  const primaryLock = recordField(value, "primaryLock");
  assertExactKeys(primaryLock, ["codeHash", "hashType", "args"]);
  const chain = requiredString(value, "chain");
  const codeHash = requiredString(primaryLock, "codeHash");
  const hashType = requiredString(primaryLock, "hashType");
  const lockArgs = requiredString(primaryLock, "args");
  const bounded = requiredBoolean(value, "bounded");
  const rpcEndpoint = parseRpcEndpointIdentity(recordField(value, "rpcEndpoint"));
  const sleepIntervalMs = requiredNumber(value, "sleepIntervalMs");
  if (bounded || value["maxIterations"] !== undefined) {
    throw new TypeError(MALFORMED_PUBLIC_IDENTITY);
  }
  const maxRetryableAttempts = optionalNumber(value, "maxRetryableAttempts");
  return {
    chain,
    primaryLock: { codeHash, hashType, args: lockArgs },
    bounded,
    ...(maxRetryableAttempts === undefined ? {} : { maxRetryableAttempts }),
    sleepIntervalMs,
    rpcEndpoint,
  };
}

function parseRpcEndpointIdentity(
  value: Record<string, unknown> | undefined,
): PublicLiveBotIdentity["rpcEndpoint"] {
  const mode = value?.["mode"];
  if (mode !== "exclusive") {
    throw new TypeError(MALFORMED_PUBLIC_IDENTITY);
  }
  assertExactKeys(value, ["mode", "protocol", "hostname", "port", "pathname"]);
  const protocol = requiredString(value, "protocol");
  const hostname = requiredString(value, "hostname");
  const port = stringField(value, "port");
  if ((protocol !== "http:" && protocol !== "https:") || port === undefined) {
    throw new TypeError(MALFORMED_PUBLIC_IDENTITY);
  }
  const pathname = requiredString(value, "pathname");
  return { mode, protocol, hostname, port, pathname };
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = stringField(record, key);
  if (value === undefined || value === "") {
    throw new TypeError(MALFORMED_PUBLIC_IDENTITY);
  }
  return value;
}

function requiredBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new TypeError(MALFORMED_PUBLIC_IDENTITY);
  }
  return value;
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
  const value = numberField(record, key);
  if (value === undefined || value < 0) {
    throw new TypeError(MALFORMED_PUBLIC_IDENTITY);
  }
  return value;
}

function optionalNumber(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  return record[key] === undefined ? undefined : requiredNumber(record, key);
}

function assertExactKeys(
  value: Record<string, unknown> | undefined,
  keys: string[],
): asserts value is Record<string, unknown> {
  const allowed = new Set(keys);
  if (value === undefined || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new TypeError(MALFORMED_PUBLIC_IDENTITY);
  }
}

function assertNoMatchableTesterOrders(report: Record<string, unknown>): void {
  const count = recordField(report, "inventory")?.["matchableUserOrderCount"];
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new Error(
      "tester preflight inventory.matchableUserOrderCount is missing or malformed",
    );
  }
  if (count > 0) {
    throw new Error(
      `tester preflight found ${String(count)} existing matchable user order(s); refusing new stimulus`,
    );
  }
}
