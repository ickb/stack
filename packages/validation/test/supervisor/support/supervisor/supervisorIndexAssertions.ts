import { expect } from "vitest";
import {
  INCIDENT_JSON_SUFFIX,
  type CapturedWriteDependencies,
} from "./supervisorIndexConstants.ts";

export function captureWrites(writes: Map<string, string>): CapturedWriteDependencies {
  return {
    appendFile: async (path, text): Promise<void> => {
      const key = pathToString(path);
      writes.set(key, `${writes.get(key) ?? ""}${textToString(text)}`);
      await Promise.resolve();
    },
    writeFile: async (path, text): Promise<void> => {
      writes.set(pathToString(path), textToString(text));
      await Promise.resolve();
    },
  };
}
export function expectNoIncident(writes: Map<string, string>): void {
  expect(
    [...writes.keys()].filter((path) => path.endsWith(INCIDENT_JSON_SUFFIX)),
  ).toHaveLength(0);
}
export function expectRetryablePreflightArtifacts(
  spawned: string[][],
  writes: Map<string, string>,
): void {
  expect(spawned.filter((args) => isPreflightCommand(args))).toHaveLength(2);
  expect(spawned.filter((args) => !isPreflightCommand(args))).toHaveLength(1);
  expect(
    writes.has(
      "/repo/log/live-supervisor/preflight-retry-test/cycle-0001-bot-preflight-attempt-1.stdout.json",
    ),
  ).toBe(true);
  expect(
    writes.has(
      "/repo/log/live-supervisor/preflight-retry-test/cycle-0001-bot-preflight-attempt-1.stdout.ndjson",
    ),
  ).toBe(false);
  expect(
    writes.has(
      "/repo/log/live-supervisor/preflight-retry-test/cycle-0001-bot-preflight-attempt-2.stdout.json",
    ),
  ).toBe(true);
  expect(
    writes.has(
      "/repo/log/live-supervisor/preflight-retry-test/cycle-0001-bot-preflight-attempt-1.command.json",
    ),
  ).toBe(true);
  expect(
    writes.has(
      "/repo/log/live-supervisor/preflight-retry-test/cycle-0001-bot-preflight-attempt-2.command.json",
    ),
  ).toBe(true);
}
export function expectSupervisorSpawnCounts(
  spawned: readonly string[][],
  expected: { preflight: number; actor: number },
): void {
  expect(spawned.filter((args) => isPreflightCommand(args))).toHaveLength(
    expected.preflight,
  );
  expect(spawned.filter((args) => !isPreflightCommand(args))).toHaveLength(
    expected.actor,
  );
}
export function jsonArtifact(writes: Map<string, string>, path: string): TestRecord {
  const text = writes.get(path);
  if (text === undefined) {
    throw new Error(`Missing artifact: ${path}`);
  }
  const parsed: unknown = JSON.parse(text);
  return recordAt(parsed, path);
}
export function recordAt(value: unknown, label: string): TestRecord {
  if (isTestRecord(value)) {
    return value;
  }
  throw new Error(`Expected record: ${label}`);
}
export function stringArrayAt(value: unknown, label: string): string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  throw new Error(`Expected string array: ${label}`);
}
export function pathToString(path: unknown): string {
  if (typeof path === "string") {
    return path;
  }
  if (Buffer.isBuffer(path)) {
    return path.toString("utf8");
  }
  if (path instanceof URL) {
    return path.toString();
  }
  throw new TypeError("Unexpected artifact path type");
}
function textToString(text: unknown): string {
  if (typeof text === "string") {
    return text;
  }
  if (ArrayBuffer.isView(text)) {
    return Buffer.from(text.buffer, text.byteOffset, text.byteLength).toString("utf8");
  }
  throw new TypeError("Unexpected artifact text type");
}
export function isTestRecord(value: unknown): value is TestRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isPreflightCommand(args: readonly string[]): boolean {
  return args[0] === "scripts/live/preflight.ts";
}
export type TestRecord = Record<string, unknown> & {
  aggregateCounts?: unknown;
  artifacts?: unknown;
  classification?: unknown;
  command?: unknown;
  coverage?: unknown;
  counts?: unknown;
  covered?: unknown;
  evidence?: unknown;
  goals?: unknown;
  preflightState?: unknown;
  retryableFailures?: unknown;
  stopDiagnostics?: unknown;
  txHashes?: unknown;
  txHashesByOutcome?: unknown;
  uniqueTxHashesByOutcome?: unknown;
  uncovered?: unknown;
  bot_match_committed?: unknown;
};
