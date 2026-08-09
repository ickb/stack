import type {
  ProcessRunnerDependencies,
  PublicRpcEndpointIdentity,
  readLinuxProcessIdentity,
  runProcess,
} from "@ickb/node-utils";
import type { lstat, mkdir } from "node:fs/promises";
import type { LIVE_BOT_STIMULUS_TESTER_SCENARIO_SELECTIONS } from "./liveBotStimulusConstants.ts";

export interface WritableLike {
  write: (chunk: string) => boolean;
}

export type LiveBotStimulusTesterScenarioSelection =
  (typeof LIVE_BOT_STIMULUS_TESTER_SCENARIO_SELECTIONS)[number];

export type StimulusArgHandler = (
  args: ParsedStimulusArgs,
  argv: string[],
  index: number,
  flag: string,
) => number;

export interface ParsedStimulusArgs {
  help: boolean;
  keepGoing: boolean;
  logRoot: string;
  sessionRoot?: string;
  botLiveConfig: string;
  testerConfig: string;
  testerScenario: LiveBotStimulusTesterScenarioSelection;
  testerFee?: string;
  testerFeeBase?: string;
  waitSeconds?: number;
  pollSeconds: number;
  commandTimeoutSeconds: number;
  preflightTimeoutSeconds: number;
}

export interface StimulusBalances {
  depositCapacity: bigint;
  projectedCkb: bigint;
  ickbAvailable: bigint;
  feeRate: bigint;
}

export interface StimulusChoice {
  scenario: Exclude<LiveBotStimulusTesterScenarioSelection, "auto">;
  testerFee?: string;
  testerFeeBase?: string;
  reason: string;
}

export interface BotEventScanState {
  offset: number;
  decoder: InstanceType<typeof TextDecoder>;
  fileIdentity?: string;
  pendingText: string;
  acceptedEventCount: number;
  malformedLineCount: number;
  matchedBuiltByIteration: Map<string, Record<string, unknown>>;
  committedByIteration: Map<string, Record<string, unknown>>;
  match?: LiveBotMatchEvidence;
  quiescenceSkip?: Record<string, unknown>;
  postMatchCommitCount: number;
  latestMatchedOrderFailure?: LiveBotMatchedOrderFailureEvidence;
  latestSkip?: Record<string, unknown>;
  latestFailure?: Record<string, unknown>;
  latestCommit?: Record<string, unknown>;
  latestEvent?: Record<string, unknown>;
  lastEventLine?: string;
  requiredOrderTxHash?: string;
  expectedRunId?: string;
}

export interface EventFileCursor {
  offset: number;
  fileIdentity?: string;
  lastEventLine?: string;
}

export interface LiveBotMatchEvidence {
  runId: string;
  iterationId: number;
  txHash: string;
  matchedOrderOutPoints: Array<{ txHash: string; index: string }>;
  matchedOrderMasterOutPoints: Array<{ txHash: string; index: string }>;
  requiredOrderTxHash?: string;
  built: Record<string, unknown>;
  committed: Record<string, unknown>;
}

export interface LiveBotMatchedOrderFailureEvidence {
  runId: string;
  iterationId: number;
  matchedOrderOutPoints: Array<{ txHash: string; index: string }>;
  matchedOrderMasterOutPoints: Array<{ txHash: string; index: string }>;
  requiredOrderTxHash?: string;
  built: Record<string, unknown>;
  failure: Record<string, unknown>;
}

export interface Dependencies {
  addSignalHandler?: NonNullable<ProcessRunnerDependencies["addSignalHandler"]>;
  appendFile?: (
    path: string,
    text: string,
    options?: { mode?: number },
  ) => Promise<unknown>;
  lstat?: typeof lstat;
  mkdir?: typeof mkdir;
  now?: () => number;
  open?: (
    path: string,
    flags: "r",
  ) => Promise<{
    read: (
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ) => Promise<{ bytesRead: number }>;
    close: () => Promise<void>;
  }>;
  readProcessIdentity?: typeof readLinuxProcessIdentity;
  receivedSignal?: () => "SIGINT" | "SIGTERM" | undefined;
  removeSignalHandler?: NonNullable<ProcessRunnerDependencies["removeSignalHandler"]>;
  readFile?: (path: string, encoding: "utf8") => Promise<string>;
  realpath?: (path: string) => Promise<string>;
  runSupervisor?: (
    argv: string[],
    io: { stdout: WritableLike; stderr: WritableLike },
  ) => Promise<number>;
  runProcess?: typeof runProcess;
  sleep?: (ms: number) => Promise<void>;
  stat?: (path: string) => Promise<{
    size: number;
    dev?: bigint | number;
    ino?: bigint | number;
  }>;
  writeFile?: (
    path: string,
    text: string,
    options?: { mode?: number },
  ) => Promise<unknown>;
}

export type LiveBotStimulusDependencies = Dependencies & {
  runSupervisor: NonNullable<Dependencies["runSupervisor"]>;
};

export interface SessionPaths {
  logRoot: string;
  sessionRoot: string;
  supervisorDir: string;
  chunksDir: string;
  botLogDir: string;
  botEventsPath: string;
  launchesPath: string;
  summaryPath: string;
  displaySessionRoot: string;
  displayBotEventsPath: string;
}

export interface LauncherProof {
  pid: number;
  childPid: number;
  runId: string;
  identity: LauncherIdentity;
  timestamp?: string;
  logDir?: string;
  botEventsPath?: string;
}

export interface LauncherIdentity {
  bootId: string;
  child: LauncherProcessIdentity;
  launcher: LauncherProcessIdentity;
}

export interface LauncherProcessIdentity {
  pid: number;
  startTimeTicks: string;
}

export interface PublicLiveBotIdentity {
  chain: string;
  primaryLock: { codeHash: string; hashType: string; args: string };
  bounded: boolean;
  maxIterations?: number;
  maxRetryableAttempts?: number;
  sleepIntervalMs: number;
  rpcEndpoint: PublicRpcEndpointIdentity;
}

export interface StimulusRunResult {
  status: number;
  outDir: string;
  summaryPath: string;
  stdout: string;
  stderr: string;
  summary?: Record<string, unknown>;
}

export type LiveBotWaitResult =
  | {
      status: "quiescent";
      elapsedMs: number;
      evidence: LiveBotMatchEvidence;
      quiescence: {
        skipped: Record<string, unknown>;
        postMatchCommitCount: number;
        latestCommit?: Record<string, unknown>;
      };
      scan: BotEventScanState;
    }
  | {
      status: "failed";
      elapsedMs: number;
      reason: string;
      scan: BotEventScanState;
    };
