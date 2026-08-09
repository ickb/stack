import type { ProcessResult } from "@ickb/node-utils";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  BOT_TRANSACTION_BUILT_EVENT as BOT_TRANSACTION_BUILT,
  BOT_TRANSACTION_COMMITTED_EVENT as BOT_TRANSACTION_COMMITTED,
  SUMMARY_JSON,
} from "../../../../src/supervisor/stimulus/shared/liveBotStimulusConstants.ts";

import type { runLiveBotStimulusTest } from "../../../../src/supervisor/stimulus/shared/liveBotStimulusTest.ts";

const { join } = path;
const TEST_PRIMARY_LOCK = {
  codeHash: `0x${"11".repeat(32)}`,
  hashType: "type",
  args: `0x${"22".repeat(20)}`,
} as const;
const TEST_TIMES = [
  1700000000000, 1700000000000, 1700000000000, 1700000000000, 1700000000100,
];

export function matchedCommitEventText(matchByte: string, commitByte: string): string {
  return `${JSON.stringify(
    botEvent(BOT_TRANSACTION_BUILT, {
      actions: {
        matchedOrders: 1,
        deposits: 0,
        withdrawalRequests: 0,
        completedDeposits: 0,
        withdrawals: 0,
        collectedOrders: 0,
      },
      ...matchedOrderDecision(matchByte),
    }),
  )}\n${JSON.stringify(botEvent(BOT_TRANSACTION_COMMITTED, { txHash: txHash(commitByte), outcome: "committed" }))}\n${JSON.stringify(
    botEvent("bot.decision.skipped", {
      iterationId: 8,
      reason: "no_actions",
      decision: { orders: { marketCount: 0, receiptCount: 0 } },
    }),
  )}\n`;
}

export function liveBotStimulusDependencies({
  root,
  writes,
  appended,
  reads,
  setEventText,
  previousEventText,
  reactionEventText,
  supervisorArgs,
  testerMatchableOrderCount = 0,
  readProcessIdentity = processIdentityFixture,
  botIdentity = testBotIdentity(),
  botRunId = "run-1",
  botPreflightCopies = 1,
  botPreflightEventFields = {},
  botPreflightReportFields = {},
}: {
  root: string;
  writes: Map<string, string>;
  appended: Map<string, string>;
  reads: Map<string, string>;
  setEventText: (text: string) => void;
  previousEventText: string;
  reactionEventText: string;
  supervisorArgs: string[][];
  testerMatchableOrderCount?: unknown;
  readProcessIdentity?: typeof processIdentityFixture;
  botIdentity?: Record<string, unknown>;
  botRunId?: string;
  botPreflightCopies?: number;
  botPreflightEventFields?: Record<string, unknown>;
  botPreflightReportFields?: Record<string, unknown>;
}): NonNullable<Parameters<typeof runLiveBotStimulusTest>[0]["dependencies"]> {
  return {
    now: steppedNow([...TEST_TIMES]),
    readProcessIdentity,
    mkdir: noopAsync,
    lstat: missingLstat,
    realpath: async (targetPath): Promise<string> => {
      await Promise.resolve();
      return targetPath;
    },
    writeFile: async (targetPath, text): Promise<undefined> => {
      writes.set(targetPath, text);
      await Promise.resolve();
      return undefined;
    },
    appendFile: async (targetPath, text): Promise<undefined> => {
      appended.set(targetPath, `${appended.get(targetPath) ?? ""}${text}`);
      await Promise.resolve();
      return undefined;
    },
    readFile: async (targetPath) =>
      readStimulusFixtureFile(targetPath, {
        reads,
        botIdentity,
        botRunId,
        botPreflightCopies,
        botPreflightEventFields,
      }),
    runProcess: async (command, commandArgs) =>
      runPreflightFixture(
        command,
        commandArgs,
        testerMatchableOrderCount,
        botPreflightReportFields,
      ),
    runSupervisor: async (argv): Promise<number> => {
      supervisorArgs.push(argv);
      setEventText(previousEventText + reactionEventText);
      const outDir = argv[argv.indexOf("--out-dir") + 1];
      const resolvedOutDir = path.isAbsolute(outDir ?? "")
        ? (outDir ?? "")
        : join(root, outDir ?? "");
      recordTesterOrderCreatedSummary(reads, resolvedOutDir);
      await Promise.resolve();
      return 0;
    },
  };
}

async function readStimulusFixtureFile(
  targetPath: string,
  context: {
    reads: Map<string, string>;
    botIdentity: Record<string, unknown>;
    botRunId: string;
    botPreflightCopies: number;
    botPreflightEventFields: Record<string, unknown>;
  },
): Promise<string> {
  const text = context.reads.get(targetPath);
  if (text !== undefined) {
    return text;
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixture paths are test-owned temporary files.
  const diskText = await readFile(targetPath, "utf8");
  if (!path.basename(targetPath).startsWith("bot.events")) {
    return diskText;
  }
  const event = `${JSON.stringify(
    botPreflightEvent(
      context.botIdentity,
      context.botRunId,
      context.botPreflightEventFields,
    ),
  )}\n`;
  return `${event.repeat(context.botPreflightCopies)}${diskText}`;
}

export const TEST_LAUNCH_IDENTITY = {
  bootId: "test-boot",
  launcher: { pid: 100, startTimeTicks: "1000" },
  child: { pid: 101, startTimeTicks: "1010" },
} as const;

export function launcherStartedRecord(
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 3,
    app: "bot-launcher",
    type: "launcher.started",
    pid: 100,
    childPid: 101,
    runId: "run-1",
    identity: TEST_LAUNCH_IDENTITY,
    timestamp: "now",
    ...fields,
  };
}

export async function processIdentityFixture(
  pid: number,
): Promise<{ bootId: string; startTimeTicks: string }> {
  await Promise.resolve();
  if (pid === TEST_LAUNCH_IDENTITY.launcher.pid) {
    return {
      bootId: TEST_LAUNCH_IDENTITY.bootId,
      startTimeTicks: TEST_LAUNCH_IDENTITY.launcher.startTimeTicks,
    };
  }
  if (pid === TEST_LAUNCH_IDENTITY.child.pid) {
    return {
      bootId: TEST_LAUNCH_IDENTITY.bootId,
      startTimeTicks: TEST_LAUNCH_IDENTITY.child.startTimeTicks,
    };
  }
  throw new Error("process not found");
}

function recordTesterOrderCreatedSummary(
  reads: Map<string, string>,
  outDir: string,
): void {
  reads.set(
    join(outDir, SUMMARY_JSON),
    JSON.stringify({
      artifacts: [],
      aggregateCounts: { tester_order_created: 1 },
      testerOrderEvidence: [
        {
          outcome: "tester_order_created",
          txHashes: [txHash("ee")],
          orderCount: 1,
          orders: [{ dust: false }],
        },
      ],
    }),
  );
}

function botPreflightEvent(
  identity: Record<string, unknown>,
  runId: string,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return botEvent("bot.chain.preflight", {
    runId,
    iterationId: 0,
    identity,
    matches: { genesisHash: true, addressPrefix: true },
    ...fields,
  });
}

export function testBotIdentity(
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    chain: "testnet",
    primaryLock: TEST_PRIMARY_LOCK,
    bounded: false,
    maxRetryableAttempts: 2,
    sleepIntervalMs: 1000,
    rpcEndpoint: {
      mode: "exclusive",
      protocol: "https:",
      hostname: "testnet.example",
      port: "",
      pathname: "/",
    },
    ...fields,
  };
}

export function botEvent(
  type: string,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return {
    version: 1,
    app: "bot",
    chain: "testnet",
    runId: "run-1",
    iterationId: 7,
    timestamp: "2026-01-01T00:00:00.000Z",
    type,
    ...fields,
  };
}

export function matchedOrderDecision(
  byte: string,
  masterByte = byte,
): Record<string, unknown> {
  return {
    decision: {
      match: {
        matchedOrderOutPoints: [{ txHash: txHash(byte), index: "0" }],
        matchedOrderMasterOutPoints: [{ txHash: txHash(masterByte), index: "1" }],
      },
    },
  };
}

export function txHash(byte: string): string {
  return `0x${byte.repeat(32)}`;
}

async function preflightResult({
  plainCkb,
  spendableCkb,
  ickb,
  bounded,
  matchableUserOrderCount,
  reportFields = {},
}: {
  plainCkb: string;
  spendableCkb: string;
  ickb: string;
  bounded: boolean;
  matchableUserOrderCount: unknown;
  reportFields?: Record<string, unknown>;
}): Promise<ProcessResult> {
  await Promise.resolve();
  return {
    status: 0,
    signal: null,
    stdout: JSON.stringify({
      chain: "testnet",
      bounded,
      ...(bounded ? { maxIterations: 1 } : {}),
      balances: {
        CKB: {
          available: plainCkb,
          plainAvailable: plainCkb,
          spendable: spendableCkb,
        },
        ICKB: { available: ickb },
      },
      capital: { depositCapacity: "1000" },
      key: { primaryLock: TEST_PRIMARY_LOCK },
      inventory: { matchableUserOrderCount },
      rpcEndpoint: {
        mode: "exclusive",
        protocol: "https:",
        hostname: "testnet.example",
        port: "",
        pathname: "/",
      },
      maxRetryableAttempts: 2,
      sleepIntervalSeconds: 1,
      system: { feeRate: "33222" },
      ...reportFields,
    }),
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    timedOut: false,
  };
}

async function runPreflightFixture(
  _command: string,
  commandArgs: readonly string[],
  testerMatchableOrderCount: unknown,
  botPreflightReportFields: Record<string, unknown>,
): Promise<ProcessResult> {
  await Promise.resolve();
  const configPath = commandArgs[commandArgs.indexOf("--config") + 1];
  const isBotLive = configPath?.includes("bot-live") === true;
  return preflightResult({
    plainCkb: isBotLive ? "4000" : "2200",
    spendableCkb: isBotLive ? "3000" : "200",
    ickb: isBotLive ? "1000" : "200",
    bounded: !isBotLive,
    matchableUserOrderCount: isBotLive ? 0 : testerMatchableOrderCount,
    reportFields: isBotLive ? botPreflightReportFields : {},
  });
}

function steppedNow(values: number[]): () => number {
  return () => values.shift() ?? values.at(-1) ?? 1700000000000;
}

async function missingLstat(): Promise<never> {
  await Promise.resolve();
  const error: NodeJS.ErrnoException = new Error("missing");
  error.code = "ENOENT";
  throw error;
}

async function noopAsync(): Promise<undefined> {
  await Promise.resolve();
  return undefined;
}
