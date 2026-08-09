import { maxTimerDelaySeconds } from "../helpers.ts";
import {
  DEFAULT_PREBUILD_TOTAL_TIMEOUT_SECONDS_VALUE,
  DEFAULT_CHILD_TIMEOUT_SECONDS_VALUE as DEFAULT_SUPERVISOR_LOOP_CHILD_TIMEOUT_SECONDS,
  type BoundedCommandResult,
  type SupervisorLoopDependencies,
} from "../loop.ts";

export const DEFAULT_SUPERVISOR_LOOP_PREBUILD_TIMEOUT_SECONDS =
  DEFAULT_PREBUILD_TOTAL_TIMEOUT_SECONDS_VALUE;
export const DEFAULT_TESTER_CONFIG = "config/tester-testnet.json";
export const DEFAULT_PREFLIGHT_SCRIPT = "scripts/live/preflight.ts";
export const DEFAULT_SUPERVISOR_LOOP_SCRIPT = "scripts/supervisor/loop-cli.ts";
export const DEFAULT_LOG_ROOT = "log";
export const TESTER_CONFIG_FLAG = "--tester-config";
export const PREFLIGHT_SCRIPT_FLAG = "--preflight-script";
export const SUPERVISOR_LOOP_SCRIPT_FLAG = "--supervisor-loop-script";
export const LOG_ROOT_FLAG = "--log-root";
export const SESSION_ROOT_FLAG = "--session-root";
export const OUT_DIR_FLAG = "--out-dir";
export const MAX_CYCLES_FLAG = "--max-cycles";
export const TESTER_SCENARIO_FLAG = "--tester-scenario";
export const MAX_CHUNKS_FLAG = "--max-chunks";
export const CHUNK_MAX_RUNS_FLAG = "--chunk-max-runs";
export const STABLE_LIMIT_FLAG = "--stable-limit";
export const CHUNK_BACKOFF_SECONDS_FLAG = "--chunk-backoff-seconds";
export const BETWEEN_CHUNKS_SECONDS_FLAG = "--between-chunks-seconds";
export const CHILD_TIMEOUT_SECONDS_FLAG = "--child-timeout-seconds";
export const COMMAND_TIMEOUT_SECONDS_FLAG = "--command-timeout-seconds";
export const CHUNK_TIMEOUT_SECONDS_FLAG = "--chunk-timeout-seconds";
export const PREFLIGHT_TIMEOUT_SECONDS_FLAG = "--preflight-timeout-seconds";
export const KEEP_GOING_FLAG = "--keep-going";
export const DEFAULT_CHUNK_MAX_RUNS = 8;
export const DEFAULT_STABLE_LIMIT = 999;
export const DEFAULT_CHUNK_BACKOFF_SECONDS = 20;
export const DEFAULT_BETWEEN_CHUNKS_SECONDS = 20;
export const DEFAULT_CHILD_TIMEOUT_SECONDS =
  DEFAULT_SUPERVISOR_LOOP_CHILD_TIMEOUT_SECONDS;
export const DEFAULT_COMMAND_TIMEOUT_SECONDS = 240;
export const DEFAULT_CHUNK_TIMEOUT_MARGIN_SECONDS = 60;
export const CHILD_COMMAND_TIMEOUT_MARGIN_SECONDS = 60;
export const MAX_SUPERVISOR_COMMANDS_PER_DYNAMIC_CHUNK = 6;
export const DEFAULT_PREFLIGHT_TIMEOUT_SECONDS = 120;
export const DYNAMIC_LOOP_OWNED_FLAGS = [
  TESTER_CONFIG_FLAG,
  PREFLIGHT_SCRIPT_FLAG,
  SUPERVISOR_LOOP_SCRIPT_FLAG,
  LOG_ROOT_FLAG,
  SESSION_ROOT_FLAG,
  MAX_CHUNKS_FLAG,
  CHUNK_MAX_RUNS_FLAG,
  STABLE_LIMIT_FLAG,
  CHUNK_BACKOFF_SECONDS_FLAG,
  BETWEEN_CHUNKS_SECONDS_FLAG,
  CHILD_TIMEOUT_SECONDS_FLAG,
  COMMAND_TIMEOUT_SECONDS_FLAG,
  CHUNK_TIMEOUT_SECONDS_FLAG,
  PREFLIGHT_TIMEOUT_SECONDS_FLAG,
  KEEP_GOING_FLAG,
];
export const DEFAULT_RAW_ORDER_FEE = 1n;
export const DEFAULT_RAW_ORDER_FEE_BASE = 100000n;
export const DEFAULT_RAW_ORDER_FEE_POLICY = {
  fee: DEFAULT_RAW_ORDER_FEE,
  feeBase: DEFAULT_RAW_ORDER_FEE_BASE,
};
export const ICKB_STIMULUS_MIN_CKB = 2100n;
export const MAX_TIMER_DELAY_SECONDS = BigInt(maxTimerDelaySeconds());
export const INVALID_PREFLIGHT_BALANCES_REASON =
  "preflight balances or fee rate missing or invalid";

export type MaybePromise<T> = T | Promise<T>;
export interface TextWriter {
  write: (chunk: string | Uint8Array) => unknown;
}
interface SymbolicLinkStats {
  isSymbolicLink: () => boolean;
}
export interface RawOrderFeePolicy {
  fee: bigint;
  feeBase: bigint;
}
type TesterScenario = "all-ckb-limit-order" | "auto" | "ickb-to-ckb-limit-order";
export interface TesterChoice {
  scenario: TesterScenario;
  feeArgs: string[];
}
export interface DynamicArgs {
  help: boolean;
  testerConfig: string;
  preflightScript: string;
  supervisorLoopScript: string;
  logRoot?: string;
  sessionRoot?: string;
  maxChunks?: number;
  chunkMaxRuns: number;
  stableLimit: number;
  chunkBackoffSeconds: number;
  betweenChunksSeconds: number;
  childTimeoutSeconds: number;
  commandTimeoutSeconds: number;
  chunkTimeoutSeconds: number;
  preflightTimeoutSeconds: number;
  keepGoing: boolean;
  supervisorArgs: string[];
}
interface DynamicLoopIo {
  stdout?: TextWriter;
  stderr?: TextWriter;
}
export type DynamicLoopDependencies = SupervisorLoopDependencies & {
  appendFile?: (path: string, text: string) => MaybePromise<unknown>;
  checkIgnored?: (relativePath: string) => boolean;
  lstat?: (path: string) => MaybePromise<SymbolicLinkStats>;
  mkdir?: (path: string, options?: { recursive?: boolean }) => MaybePromise<unknown>;
  sleep?: (ms: number) => MaybePromise<unknown>;
  stat?: (path: string) => MaybePromise<unknown>;
  writeFile?: (path: string, text: string) => MaybePromise<unknown>;
};
export interface RunDynamicSupervisorLoopInput {
  argv: readonly string[];
  root?: string;
  dependencies?: DynamicLoopDependencies;
  io?: DynamicLoopIo;
}
export type TextCommandResult = Omit<
  BoundedCommandResult,
  "signal" | "stderr" | "stdout"
> & {
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
};
export interface TesterScenarioInput {
  ckb: bigint;
  plainCkb?: bigint;
  ickb: bigint;
  feeRate: bigint;
  rawOrderFeePolicy?: RawOrderFeePolicy;
}
export interface TesterPreflightFailure {
  ok: false;
  status: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  reason: string;
  retryableStatusOne: boolean;
}
export interface TesterPreflightSuccess {
  ok: true;
  ckb: bigint;
  plainCkb?: bigint;
  ickb: bigint;
  ickbUnavailable?: bigint;
  ickbTotal?: bigint;
  feeRate: bigint;
  ckbText: string;
  plainCkbText?: string;
  projectedCkbText?: string;
  ickbText: string;
  ickbUnavailableText?: string;
  ickbTotalText?: string;
}
export type TesterPreflightResult = TesterPreflightFailure | TesterPreflightSuccess;
export type JsonParseResult = { ok: true; value: unknown } | { ok: false };
export type JsonValue =
  | bigint
  | boolean
  | null
  | number
  | readonly unknown[]
  | Record<string, unknown>
  | string
  | undefined;
export interface ParsedPreflightBalances {
  ckb: bigint;
  feeRate: bigint;
  ickb: bigint;
  ickbTotal?: bigint;
  ickbUnavailable?: bigint;
  plainCkb?: bigint;
}
export type OptionalParsedBalanceField = { ok: true; value?: bigint } | { ok: false };
export type RequiredParsedBalanceField = { ok: true; value: bigint } | { ok: false };
export interface PreflightBalanceText {
  ckbText?: string;
  feeRateText?: string;
  ickbText?: string;
  ickbTotalText?: string;
  ickbUnavailableText?: string;
  plainCkbText?: string;
  projectedCkbText?: string;
}
export interface ValidationSession {
  logRoot: string;
  sessionRoot: string;
  supervisorDir: string;
  chunksDir: string;
  displayLogRoot: string;
  displaySessionRoot: string;
}
export interface ContinueAfterChunkInput {
  args: DynamicArgs;
  dependencies: DynamicLoopDependencies;
  session: ValidationSession;
  stdout: TextWriter;
  chunkIndex: number;
  reason: string | undefined;
  status: number | null;
}
export interface DynamicLoopRuntime {
  args: DynamicArgs;
  dependencies: DynamicLoopDependencies;
  root: string;
  session: ValidationSession;
  stderr: TextWriter;
  stdout: TextWriter;
}
export interface PreflightFailureInput extends DynamicLoopRuntime {
  chunkIndex: number;
  consecutiveStatusOneStops: number;
  preflight: TesterPreflightFailure;
}
export type ChunkStep =
  | { kind: "continue"; consecutiveStatusOneStops: number }
  | { kind: "return"; exitCode: number };
export interface SupervisorChunkInput extends DynamicLoopRuntime {
  choice: TesterChoice;
  chunkIndex: number;
}
export interface ParsedDynamicOption {
  chunkTimeoutSecondsExplicit?: boolean;
  index: number;
  values: Partial<DynamicArgs>;
}
export type DynamicStringField =
  "logRoot" | "preflightScript" | "sessionRoot" | "supervisorLoopScript" | "testerConfig";
export type DynamicNumberField =
  | "betweenChunksSeconds"
  | "childTimeoutSeconds"
  | "chunkBackoffSeconds"
  | "chunkMaxRuns"
  | "chunkTimeoutSeconds"
  | "commandTimeoutSeconds"
  | "maxChunks"
  | "preflightTimeoutSeconds"
  | "stableLimit";
export type DynamicOptionParser = (
  argv: readonly string[],
  index: number,
  flag: string,
) => ParsedDynamicOption;
