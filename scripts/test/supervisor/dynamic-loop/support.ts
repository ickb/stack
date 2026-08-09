import {
  chooseTesterScenario as chooseTesterScenarioRaw,
  DEFAULT_CHILD_TIMEOUT_SECONDS_VALUE as DEFAULT_SUPERVISOR_LOOP_CHILD_TIMEOUT_SECONDS,
  type DynamicArgs,
  type DynamicLoopDependencies,
  fixed8DecimalToUnits,
  parseArgs as parseDynamicArgs,
  type RunDynamicSupervisorLoopInput,
  runDynamicSupervisorLoop as runDynamicSupervisorLoopRaw,
  type TesterChoice,
  type TesterScenarioInput,
  usage,
} from "../../../supervisor/dynamic-loop.ts";
import type {
  BoundedCommandOptions,
  BoundedCommandResult,
} from "../../../supervisor/loop.ts";
export { DEFAULT_SUPERVISOR_LOOP_CHILD_TIMEOUT_SECONDS, fixed8DecimalToUnits, usage };

export interface TestOutput {
  text: string;
  write: (chunk: string | Uint8Array) => void;
}

export type TestSpawnOptions = BoundedCommandOptions;
export type SpawnResultFixture = BoundedCommandResult;

export interface CommandInvocation {
  command?: string;
  args: readonly string[];
  options: TestSpawnOptions;
}

export interface PreflightBalanceFixture {
  ckb: string;
  plainCkb?: string;
  projectedCkb?: string;
  ickb: string;
  unavailableIckb?: string;
  totalIckb?: string;
  feeRate: string;
}

export type SpawnFixture =
  | SpawnResultFixture
  | ((args: readonly string[], options: TestSpawnOptions) => SpawnResultFixture);

export type DynamicDependencies = DynamicLoopDependencies;
export type RunDynamicSupervisorLoopOptions = RunDynamicSupervisorLoopInput;
export type TesterChoiceInput = TesterScenarioInput;

export const LIVE_CHECK_SOURCE_COMMAND = "live:check:source";
export const PREFLIGHT_SCRIPT = "scripts/live/preflight.ts";
export const SUPERVISOR_LOOP_SCRIPT = "scripts/supervisor/loop-cli.ts";
export const REPO_SUPERVISOR_LOOP_SCRIPT = `/repo/${SUPERVISOR_LOOP_SCRIPT}`;
export const LIVE_SUPERVISOR_OUT = "log/live-supervisor/test";
export const VALIDATION_ROOT = "/repo/log/validation";
export const CUSTOM_TESTER_CONFIG = "config/custom-tester.json";
export const TESTER_CONFIG_OPTION = "--tester-config";
export const LOG_ROOT_OPTION = "--log-root";
export const SESSION_ROOT_OPTION = "--session-root";
export const MAX_CHUNKS_OPTION = "--max-chunks";
export const CHUNK_MAX_RUNS_OPTION = "--chunk-max-runs";
export const STABLE_LIMIT_OPTION = "--stable-limit";
export const CHUNK_BACKOFF_SECONDS_OPTION = "--chunk-backoff-seconds";
export const BETWEEN_CHUNKS_SECONDS_OPTION = "--between-chunks-seconds";
export const CHILD_TIMEOUT_SECONDS_OPTION = "--child-timeout-seconds";
export const COMMAND_TIMEOUT_SECONDS_OPTION = "--command-timeout-seconds";
export const CHUNK_TIMEOUT_SECONDS_OPTION = "--chunk-timeout-seconds";
export const PREFLIGHT_TIMEOUT_SECONDS_OPTION = "--preflight-timeout-seconds";
export const KEEP_GOING_OPTION = "--keep-going";
export const PREFLIGHT_SCRIPT_OPTION = "--preflight-script";
export const SUPERVISOR_LOOP_SCRIPT_OPTION = "--supervisor-loop-script";
export const OUT_ROOT_OPTION = "--out-root";
export const TARGET_OUTCOME_OPTION = "--target-outcome";
export const TESTER_SCENARIO_OPTION = "--tester-scenario";
export const SCENARIO_OPTION = "--scenario";
export const TESTER_FEE_OPTION = "--tester-fee";
export const TESTER_FEE_BASE_OPTION = "--tester-fee-base";
export const ALL_CKB_LIMIT_ORDER = "all-ckb-limit-order";
export const ICKB_TO_CKB_LIMIT_ORDER = "ickb-to-ckb-limit-order";
const AUTO_SCENARIO = "auto";
const DEFAULT_LIMIT_ORDER_FEE_ARGS = [
  TESTER_FEE_OPTION,
  "1",
  TESTER_FEE_BASE_OPTION,
  "1000",
];
export const AUTO_CHOICE: TesterChoice = { scenario: AUTO_SCENARIO, feeArgs: [] };
export const ALL_CKB_LIMIT_ORDER_CHOICE: TesterChoice = {
  scenario: ALL_CKB_LIMIT_ORDER,
  feeArgs: [],
};
export const ICKB_TO_CKB_LIMIT_ORDER_CHOICE: TesterChoice = {
  scenario: ICKB_TO_CKB_LIMIT_ORDER,
  feeArgs: DEFAULT_LIMIT_ORDER_FEE_ARGS,
};
export const SPAWN_TIMEOUT_MESSAGE = "spawn ETIMEDOUT";
export const TESTER_CONFIG_SPAWN_ERROR =
  "should not spawn before tester config boundary passes";
export const TESTER_CONFIG_MKDIR_ERROR =
  "should not create session before tester config boundary passes";
export const TESTER_CONFIG_WRITE_ERROR =
  "should not write launch artifact before tester config boundary passes";

export function parseArgs(argv: string[]): DynamicArgs {
  return parseDynamicArgs(argv);
}

export async function runDynamicSupervisorLoop(
  options: RunDynamicSupervisorLoopOptions,
): Promise<number> {
  return runDynamicSupervisorLoopRaw(options);
}

export const chooseTesterScenario: (input: TesterChoiceInput) => TesterChoice =
  chooseTesterScenarioRaw;

export function testOutput(): TestOutput {
  return {
    text: "",
    write(chunk): void {
      this.text += chunk.toString();
    },
  };
}

export function validationArgs(
  session: string,
  maxChunks = "1",
  ...extra: string[]
): string[] {
  return [
    LOG_ROOT_OPTION,
    "log",
    SESSION_ROOT_OPTION,
    `log/validation/${session}`,
    MAX_CHUNKS_OPTION,
    maxChunks,
    ...extra,
  ];
}

export function scriptCount(
  commands: ReadonlyArray<CommandInvocation | readonly string[]>,
  script: string,
): number {
  return commands.filter((command) => commandArgs(command)[0] === script).length;
}

export function hasScript(
  commands: ReadonlyArray<CommandInvocation | readonly string[]>,
  script: string,
): boolean {
  return commands.some((command) => commandArgs(command)[0] === script);
}

function commandArgs(command: CommandInvocation | readonly string[]): readonly string[] {
  return "args" in command ? command.args : command;
}

export function commandEnv(
  command: CommandInvocation,
): Record<string, string | undefined> {
  return command.options.env ?? {};
}

export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  return required(item, `Missing fixture item at index ${String(index)}`);
}

export function required<T>(item: T | undefined, message: string): T {
  if (item === undefined) {
    throw new Error(message);
  }
  return item;
}

export function argsByScript(
  commands: ReadonlyArray<readonly string[]>,
  script: string,
): readonly string[] {
  return required(
    commands.find((args) => args[0] === script),
    `Missing command args for ${script}`,
  );
}

export function commandByScript(
  commands: readonly CommandInvocation[],
  script: string,
): CommandInvocation {
  return required(
    commands.find((command) => command.args[0] === script),
    `Missing command for ${script}`,
  );
}

export function requireBigInt(value: bigint | undefined): bigint {
  if (value === undefined) {
    throw new Error("Missing bigint fixture value");
  }
  return value;
}

export function okResult(): SpawnResultFixture {
  return { status: 0, signal: null, stdout: "", stderr: "" };
}

export function preflightResult(balance: PreflightBalanceFixture): SpawnResultFixture {
  return {
    status: 0,
    signal: null,
    stdout: JSON.stringify({
      balances: {
        CKB:
          balance.plainCkb === undefined
            ? { available: balance.ckb }
            : {
                available: balance.ckb,
                plainAvailable: balance.plainCkb,
                projectedAvailable: balance.projectedCkb,
              },
        ICKB: {
          available: balance.ickb,
          unavailable: balance.unavailableIckb,
          total: balance.totalIckb,
        },
      },
      system: { feeRate: balance.feeRate },
    }),
    stderr: "",
  };
}

export function maxRunsSupervisorResult(options: {
  outcome?: string;
  out: string;
  status?: number;
}): SpawnResultFixture {
  const outcome = options.outcome ?? "-";
  return {
    status: options.status ?? 0,
    signal: null,
    stdout: `loop run=1 status=0 stopped=max_cycles outcomes=${outcome} tx=0 new=- stable=1 state=- decision=max_runs out=${options.out}\n`,
    stderr: "",
  };
}

export function dynamicDependencies(
  spawnSync: NonNullable<DynamicDependencies["spawnSync"]>,
  overrides: Partial<DynamicDependencies> = {},
): DynamicDependencies {
  return {
    checkIgnored: () => true,
    stat: missingStat,
    lstat: missingStat,
    mkdir: () => true,
    writeFile: () => true,
    appendFile: () => true,
    spawnSync,
    ...overrides,
  };
}

export function loggedDynamicSpawn(options: {
  argsLog?: Array<readonly string[]>;
  commands?: CommandInvocation[];
  preflight?: SpawnFixture;
  supervisor: SpawnFixture;
}): NonNullable<DynamicDependencies["spawnSync"]> {
  return (_command, args, spawnOptions) => {
    options.argsLog?.push(args);
    options.commands?.push({ args, options: spawnOptions });
    if (isPrebuildCommand(args)) {
      return okResult();
    }
    if (args[0] === PREFLIGHT_SCRIPT && options.preflight !== undefined) {
      return spawnFixtureResult(options.preflight, args, spawnOptions);
    }
    return spawnFixtureResult(options.supervisor, args, spawnOptions);
  };
}

function spawnFixtureResult(
  fixture: SpawnFixture,
  args: readonly string[],
  options: TestSpawnOptions,
): SpawnResultFixture {
  return typeof fixture === "function" ? fixture(args, options) : fixture;
}

export function appendRecorder(): {
  appended: Map<string, string>;
  appendFile: (path: string, text: string) => void;
} {
  const appended = new Map<string, string>();
  return {
    appended,
    appendFile(path, text): void {
      appended.set(path, `${appended.get(path) ?? ""}${text}`);
    },
  };
}

export function writeRecorder(): {
  writes: Map<string, string>;
  writeFile: (path: string, text: string) => void;
} {
  const writes = new Map<string, string>();
  return {
    writes,
    writeFile(path, text): void {
      writes.set(path, text);
    },
  };
}

export function missingStat(): never {
  throw errorWithCode("missing", "ENOENT");
}

export function errorWithCode(message: string, code: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

export function isPrebuildCommand(args: readonly string[]): boolean {
  return args[0] === LIVE_CHECK_SOURCE_COMMAND;
}
