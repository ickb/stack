import path from "node:path";

import { expect } from "vitest";

import type { balancesFromPreflight } from "../../../../src/supervisor/stimulus/selection/liveBotStimulusSelection.ts";
import { TESTER_ORDER_CREATED } from "../../../../src/supervisor/stimulus/shared/liveBotStimulusConstants.ts";
import type {
  Dependencies,
  LiveBotWaitResult,
  SessionPaths,
  StimulusRunResult,
} from "../../../../src/supervisor/stimulus/shared/liveBotStimulusTypes.ts";
import { TEST_SESSION, txHash } from "../../support/stimulus/liveBotStimulus.ts";

const { join } = path;

export function sessionPaths(root: string, session = TEST_SESSION): SessionPaths {
  const logRoot = root;
  const sessionRoot = join(logRoot, "validation", session);
  const supervisorDir = join(sessionRoot, "supervisor");
  return {
    logRoot,
    sessionRoot,
    supervisorDir,
    chunksDir: join(sessionRoot, "chunks"),
    botLogDir: join(logRoot, "bot"),
    botEventsPath: join(logRoot, "bot", "bot.events.ndjson"),
    launchesPath: join(logRoot, "bot", "launches.ndjson"),
    summaryPath: join(sessionRoot, "summary.json"),
    displaySessionRoot: join("validation", session),
    displayBotEventsPath: join("bot", "bot.events.ndjson"),
  };
}

export function expectFailedWait(
  result: LiveBotWaitResult,
): Extract<LiveBotWaitResult, { status: "failed" }> {
  if (result.status !== "failed") {
    expect.fail("Expected failed wait result");
  }
  return result;
}

export function balances(overrides: {
  depositCapacity?: bigint;
  plainCkb?: bigint;
  projectedCkb?: bigint;
  spendableCkb?: bigint;
  ickbAvailable?: bigint;
  feeRate?: bigint;
}): ReturnType<typeof balancesFromPreflight> {
  return {
    depositCapacity: 0n,
    plainCkb: 0n,
    projectedCkb: 0n,
    spendableCkb: 0n,
    ickbAvailable: 0n,
    feeRate: 0n,
    ...overrides,
  };
}

export function errno(message: string, code: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(message);
  error.code = code;
  return error;
}

export function readableHandle(
  text: string,
  maxReadBytes = Number.MAX_SAFE_INTEGER,
): NonNullable<Dependencies["open"]> extends (
  path: string,
  flags: "r",
) => Promise<infer Handle>
  ? Handle
  : never {
  return {
    async read(
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ): Promise<{ bytesRead: number }> {
      const source = Buffer.from(text).subarray(
        position,
        position + Math.min(length, maxReadBytes),
      );
      source.copy(buffer, offset);
      await Promise.resolve();
      return { bytesRead: source.length };
    },
    async close(): Promise<void> {
      await Promise.resolve();
    },
  };
}

export async function asyncNoop(): Promise<void> {
  await Promise.resolve();
}

export function mapWrite(
  writes: Map<string, string>,
): NonNullable<Dependencies["writeFile"]> {
  return async (targetPath, text) => {
    writes.set(targetPath, text);
    await Promise.resolve();
  };
}

export function mapAppend(
  appended: Map<string, string>,
): NonNullable<Dependencies["appendFile"]> {
  return async (targetPath, text) => {
    appended.set(targetPath, `${appended.get(targetPath) ?? ""}${text}`);
    await Promise.resolve();
  };
}

export function asyncText(text: string): NonNullable<Dependencies["readFile"]> {
  return async () => {
    await Promise.resolve();
    return text;
  };
}

export function asyncSize(size: number): NonNullable<Dependencies["stat"]> {
  return async () => {
    await Promise.resolve();
    return { size };
  };
}

export function asyncOpen(
  text: string,
  maxReadBytes?: number,
): NonNullable<Dependencies["open"]> {
  return async () => {
    await Promise.resolve();
    return readableHandle(text, maxReadBytes);
  };
}

export function liveStimulusDependencies(): Dependencies & {
  runSupervisor: NonNullable<Dependencies["runSupervisor"]>;
} {
  return {
    runSupervisor: async (): Promise<number> => {
      await Promise.resolve();
      return 0;
    },
  };
}

export function stimulus(overrides: Partial<StimulusRunResult> = {}): StimulusRunResult {
  return {
    status: 0,
    outDir: "out",
    summaryPath: "summary.json",
    stdout: "",
    stderr: "",
    summary: {
      artifacts: [],
      aggregateCounts: { [TESTER_ORDER_CREATED]: 1 },
      testerOrderEvidence: [
        {
          outcome: TESTER_ORDER_CREATED,
          txHashes: [txHash("fa")],
          orderCount: 1,
          orders: [{ dust: false }],
        },
      ],
    },
    ...overrides,
  };
}
