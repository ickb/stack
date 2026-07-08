import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import {
  mkdir as fsMkdir,
  open as fsOpen,
  readFile as fsReadFile,
  stat as fsStat,
  symlink as fsSymlink,
  writeFile as fsWriteFile,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseArgs, parseTimeBound } from "../../../bot/incident/args.ts";
import { collectIncident } from "../../../bot/incident/index.ts";

export type CollectorOptions = Parameters<typeof collectIncident>[0];
export type CollectorResult = Awaited<ReturnType<typeof collectIncident>>;
export type BundleResult = Extract<CollectorResult, { incidentDir: string }>;
export type TestFileHandle = Pick<Awaited<ReturnType<typeof fsOpen>>, "close"> & {
  readableWebStream: () => ReadableStream<Uint8Array>;
  stat: () => Promise<Stats>;
};
export interface FixtureLogs {
  events: string[];
  launches: string[];
  stderr: string[];
}
export interface FixtureSlotLogs {
  eventSlots: Record<string, string[]>;
  launches: string[];
  stderrSlots: Record<string, string[]>;
}
export type JsonFields = Record<string, unknown>;
export interface ArtifactSummary {
  included: unknown[];
  mismatched: unknown[];
  missing: unknown[];
}
export interface BotEventSummary {
  countsByType: Record<string, number>;
  failureReasons: Record<string, number>;
  skipReasons: Record<string, number>;
  txHashesByOutcome: Record<string, string[]>;
}
export interface CompressionSummary {
  command: string;
}
export interface IncidentSummary {
  artifacts: ArtifactSummary;
  botEvents: BotEventSummary;
  compression: CompressionSummary;
  launches: { exitCodes: Record<string, number> };
  logDir?: string;
  logRoot?: string;
  logRootSource?: string;
  sources: Record<string, SourceSummary>;
}
export interface SourceSummary {
  included?: boolean;
  malformedLines?: number;
  selectedLines?: number;
  selectedUndatedLines?: number;
  timestampedLines?: number;
  undatedLines?: number;
  undatedTailIncluded?: boolean;
  undatedTailLimit?: number;
}
export interface VersionJson {
  gitCommit: string | null;
}
export interface ReferencedArtifactFixture {
  artifactFileName: string;
  artifactHash: string;
  artifactPath: string;
}

export const { join, resolve } = path;
export const rootDir = fileURLToPath(new URL("../../../..", import.meta.url));
export const collector = join(rootDir, "scripts", "bot", "collect-incident.ts");
export const moduleDefaultFlag = "--experimental-default-type=module";
export const canaryPrivateKey = `0x${"42".repeat(32)}`;
export const logRootOption = "--log-root";
export const logDirOption = "--log-dir";
export const sinceOption = "--since";
export const untilOption = "--until";
export const fixtureNow = "2026-05-25T12:00:00.000Z";
export const windowSince = "2026-05-25T10:00:00.000Z";
export const windowUntil = "2026-05-25T11:00:00.000Z";
export const launcherStarted = "launcher.started";
export const launcherChildExited = "launcher.child.exited";
export const botRunStarted = "bot.run.started";
export const botDecisionSkipped = "bot.decision.skipped";
export const botRebalanceEvaluated = "bot.rebalance.evaluated";
export const botEventsNdjson = "bot.events.ndjson";
export const botStderrLog = "bot.stderr.log";
export const slot00EventsNdjson = "bot.events.slot-00.ndjson";
export const slot01EventsNdjson = "bot.events.slot-01.ndjson";
export const slot00StderrLog = "bot.stderr.slot-00.log";
export const slot01StderrLog = "bot.stderr.slot-01.log";
export const launchesNdjson = "launches.ndjson";
export const summaryJson = "summary.json";
export const versionJson = "version.json";
export const artifactsDirectory = "artifacts";
export const slot00Directory = "slot-00";
export const ringSegmentsDirectory = "ringSegments";
export const ringSegmentsKind = "bot.ringSegments";
export async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ickb-bot-incident-"));
}

export async function collectBundle(options: CollectorOptions): Promise<BundleResult> {
  const result = await collectIncident(options);
  assert.ok(result.incidentDir !== undefined && result.incidentDir !== "");
  return result;
}

export async function assertWindowedBundleOutputs(incidentDir: string): Promise<void> {
  assert.equal(
    await readText(join(incidentDir, botStderrLog)),
    [
      "2026-05-25T10:15:00.000Z runtime warning\n",
      "    at worker (bot.js:10:1)\n",
      "undated warning\n",
    ].join(""),
  );

  const eventBundle = await readText(join(incidentDir, botEventsNdjson));
  assert.match(eventBundle, /bot\.run\.started/u);
  assert.match(eventBundle, /non-bot stdout/u);
  assert.doesNotMatch(eventBundle, /09:59:59|11:00:01|not-json/u);
}

export function windowedFixtureEvents(): string[] {
  return [
    botEvent("2026-05-25T09:59:59.000Z", "bot.transaction.sent", {
      outcome: "broadcasted",
      txHash: txHash("01"),
    }),
    botEvent(windowSince, botRunStarted, { bounded: true }),
    "not-json\n",
    `${JSON.stringify({
      app: "execution",
      timestamp: "2026-05-25T10:05:00.000Z",
      message: "non-bot stdout",
    })}\n`,
    botEvent("2026-05-25T10:10:00.000Z", botDecisionSkipped, {
      reason: "no_actions",
    }),
    botEvent("2026-05-25T10:20:00.000Z", "bot.transaction.sent", {
      outcome: "broadcasted",
      txHash: txHash("02"),
    }),
    botEvent("2026-05-25T10:21:00.000Z", "bot.transaction.failed", {
      outcome: "timeout_after_broadcast",
      txHash: txHash("02"),
    }),
    botEvent(windowUntil, "bot.iteration.failed", {
      error: { message: "fetch failed" },
      retryable: true,
      terminal: false,
    }),
    botEvent("2026-05-25T10:59:59.500Z", "bot.iteration.failed", {
      error: { message: "fetch failed" },
      retryable: true,
      terminal: true,
      retryableAttempts: 3,
      maxRetryableAttempts: 3,
      retryBudgetExhausted: true,
    }),
    botEvent("2026-05-25T11:00:01.000Z", "bot.transaction.committed", {
      outcome: "committed",
      txHash: txHash("03"),
    }),
  ];
}

export function windowedFixtureLaunches(): string[] {
  return [
    launch("2026-05-25T09:00:00.000Z", launcherStarted, { status: null }),
    launch(windowSince, launcherStarted, { status: null }),
    launch("2026-05-25T10:30:00.000Z", launcherChildExited, { status: 2 }),
    "{bad-json\n",
    launch("2026-05-25T11:00:01.000Z", launcherChildExited, { status: 0 }),
  ];
}

export function windowedFixtureStderr(): string[] {
  return [
    "2026-05-25T09:00:00.000Z before window\n",
    "2026-05-25T10:15:00.000Z runtime warning\n",
    "    at worker (bot.js:10:1)\n",
    "undated warning\n",
    "2026-05-25T11:00:01.000Z after window\n",
    "outside continuation\n",
  ];
}

export function referencedArtifactFixture(
  artifactText: string,
): ReferencedArtifactFixture {
  const artifactHash = sha256Ref(artifactText);
  const artifactFileName = `sha256-${artifactHash.slice("sha256:".length)}.json`;
  return {
    artifactFileName,
    artifactHash,
    artifactPath: ringSegmentsArtifactPath(artifactFileName),
  };
}

export function referencedArtifactEvents(artifact: ReferencedArtifactFixture): string[] {
  return [
    artifactEvent(windowSince, artifact.artifactHash, artifact.artifactPath),
    artifactEvent(
      "2026-05-25T10:01:00.000Z",
      `sha256:${"b".repeat(64)}`,
      ringSegmentsArtifactPath(
        "sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json",
      ),
    ),
  ];
}

export function artifactEvent(
  timestamp: string,
  hash: string,
  artifactPath: string,
): string {
  return botEvent(timestamp, botRebalanceEvaluated, {
    rebalance: {
      diagnostics: {
        ring: {
          segmentsRef: {
            kind: ringSegmentsKind,
            hash,
            path: artifactPath,
          },
        },
      },
    },
  });
}

export async function assertWindowedBundleSummary(
  incidentDir: string,
  logDir: string,
): Promise<void> {
  const summary = await readIncidentSummary(incidentDir);
  assert.equal(summary.logDir, logDir);
  assert.deepEqual(summary.botEvents.countsByType, {
    [botDecisionSkipped]: 1,
    "bot.iteration.failed": 2,
    [botRunStarted]: 1,
    "bot.transaction.failed": 1,
    "bot.transaction.sent": 1,
  });
  assert.deepEqual(summary.botEvents.txHashesByOutcome, {
    broadcasted: [txHash("02")],
    timeout_after_broadcast: [txHash("02")],
  });
  assert.deepEqual(summary.botEvents.skipReasons, { no_actions: 1 });
  assert.deepEqual(summary.botEvents.failureReasons, {
    "fetch failed": 1,
    retry_budget_exhausted: 1,
    timeout_after_broadcast: 1,
  });
  assert.deepEqual(summary.launches.exitCodes, { 2: 1 });
  assert.equal(sourceSummary(summary, botEventsNdjson).malformedLines, 1);
  assert.equal(sourceSummary(summary, botEventsNdjson).selectedLines, 7);
  assert.equal(sourceSummary(summary, botStderrLog).undatedLines, 3);
  assert.equal(sourceSummary(summary, botStderrLog).selectedUndatedLines, 2);
  assert.match(summary.compression.command, /tar -czf/u);
}

export async function writeFixtureLogs(
  root: string,
  { events, launches, stderr }: FixtureLogs,
): Promise<string> {
  const logDir = join(root, "bot");
  await mkdirp(logDir);
  await writeText(join(logDir, botEventsNdjson), events.join(""), {
    mode: 0o600,
  });
  await writeText(join(logDir, launchesNdjson), launches.join(""), {
    mode: 0o600,
  });
  await writeText(join(logDir, botStderrLog), stderr.join(""), {
    mode: 0o600,
  });
  return logDir;
}

export async function writeFixtureSlotLogs(
  root: string,
  { eventSlots, launches, stderrSlots }: FixtureSlotLogs,
): Promise<string> {
  const logDir = join(root, "bot");
  await mkdirp(logDir);
  for (const [name, lines] of Object.entries(eventSlots)) {
    await writeText(join(logDir, name), lines.join(""), { mode: 0o600 });
  }
  for (const [name, lines] of Object.entries(stderrSlots)) {
    await writeText(join(logDir, name), lines.join(""), { mode: 0o600 });
  }
  await writeText(join(logDir, launchesNdjson), launches.join(""), {
    mode: 0o600,
  });
  return logDir;
}

export async function mkdirp(dir: string): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Collector tests create directories inside temp fixtures only.
  await fsMkdir(dir, { recursive: true, mode: 0o700 });
}

export function botEvent(
  timestamp: string,
  type: string,
  fields: JsonFields = {},
): string {
  return `${JSON.stringify({
    version: 1,
    app: "bot",
    chain: "testnet",
    runId: "run-fixture",
    iterationId: 1,
    timestamp,
    type,
    ...fields,
  })}\n`;
}

export function launch(timestamp: string, type: string, fields: JsonFields = {}): string {
  return `${JSON.stringify({
    version: 1,
    app: "bot-launcher",
    timestamp,
    type,
    status: null,
    signal: null,
    ...fields,
  })}\n`;
}

export function txHash(byte: string): string {
  return `0x${byte.repeat(32)}`;
}

export function sha256Ref(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

export function commonArgs(logRoot: string): string[] {
  return [
    logRootOption,
    resolve(logRoot),
    sinceOption,
    windowSince,
    untilOption,
    windowUntil,
  ];
}

export function fixtureDate(): Date {
  return new Date(fixtureNow);
}

export async function mode(filePath: string): Promise<number> {
  return (await statPath(filePath)).mode & 0o777;
}

export async function openPath(
  filePath: string,
  flags: number,
  fileMode?: number,
): Promise<TestFileHandle> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fsOpen returns Node's FileHandle, which structurally satisfies the collector dependency handle used by this test.
  return fsOpen(filePath, flags, fileMode);
}

export async function readIncidentSummary(incidentDir: string): Promise<IncidentSummary> {
  return parseIncidentSummary(await readText(join(incidentDir, summaryJson)));
}

export async function readText(filePath: string): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Collector tests read repo-local scripts or their own temp fixture outputs.
  return fsReadFile(filePath, "utf8");
}

export async function readVersionJson(incidentDir: string): Promise<VersionJson> {
  return parseVersionJson(await readText(join(incidentDir, versionJson)));
}

export async function statPath(filePath: string): Promise<Stats> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Collector tests stat paths inside their own temp fixture directories.
  return fsStat(filePath);
}

export async function writeText(
  filePath: string,
  data: string,
  options?: Parameters<typeof fsWriteFile>[2],
): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Collector tests write files inside their own temp fixture directories.
  await fsWriteFile(filePath, data, options);
}

export async function linkSymbolic(
  target: string,
  linkPath: string,
  type?: "dir" | "file" | "junction",
): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Symlink tests intentionally create links inside their temp directory.
  await fsSymlink(target, linkPath, type);
}

export function splitReadHandle(filePath: string, chunks: Uint8Array[]): TestFileHandle {
  return {
    async close(): Promise<void> {
      await Promise.resolve();
    },
    readableWebStream(): ReadableStream<Uint8Array> {
      return new ReadableStream({
        start(controller): void {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });
    },
    async stat(): Promise<Stats> {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Split-read fixture stats the collector temp log file path.
      return fsStat(filePath);
    },
  };
}

export function parseIncidentSummary(text: string): IncidentSummary {
  const value: unknown = JSON.parse(text);
  if (isIncidentSummary(value)) {
    return value;
  }
  throw new Error("Expected incident summary JSON");
}

export function parseVersionJson(text: string): VersionJson {
  const value: unknown = JSON.parse(text);
  if (isVersionJson(value)) {
    return value;
  }
  throw new Error("Expected version JSON");
}

export function isIncidentSummary(value: unknown): value is IncidentSummary {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isVersionJson(value: unknown): value is VersionJson {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function ringSegmentsArtifactPath(fileName: string): string {
  return `${artifactsDirectory}/${slot00Directory}/${ringSegmentsDirectory}/${fileName}`;
}

export function sourceSummary(summary: IncidentSummary, name: string): SourceSummary {
  const source = summary.sources[name];
  assert.ok(source !== undefined);
  return source;
}
export { collectIncident, parseArgs, parseTimeBound, rm, spawnSync };
