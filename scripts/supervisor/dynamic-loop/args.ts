import {
  maxTimerDelaySeconds,
  parseNonNegativeTimerSeconds,
  parsePositiveInteger,
  parsePositiveTimerSeconds,
  valueAfter,
} from "../helpers.ts";
import { TIMEOUT_KILL_GRACE_MS } from "../loop/model.ts";
import {
  BETWEEN_CHUNKS_SECONDS_FLAG,
  CHILD_COMMAND_TIMEOUT_MARGIN_SECONDS,
  CHILD_TIMEOUT_SECONDS_FLAG,
  CHUNK_BACKOFF_SECONDS_FLAG,
  CHUNK_MAX_RUNS_FLAG,
  CHUNK_TIMEOUT_SECONDS_FLAG,
  COMMAND_TIMEOUT_SECONDS_FLAG,
  DEFAULT_BETWEEN_CHUNKS_SECONDS,
  DEFAULT_CHILD_TIMEOUT_SECONDS,
  DEFAULT_CHUNK_BACKOFF_SECONDS,
  DEFAULT_CHUNK_MAX_RUNS,
  DEFAULT_CHUNK_TIMEOUT_MARGIN_SECONDS,
  DEFAULT_COMMAND_TIMEOUT_SECONDS,
  DEFAULT_LOG_ROOT,
  DEFAULT_PREFLIGHT_SCRIPT,
  DEFAULT_PREFLIGHT_TIMEOUT_SECONDS,
  DEFAULT_STABLE_LIMIT,
  DEFAULT_SUPERVISOR_LOOP_PREBUILD_TIMEOUT_SECONDS,
  DEFAULT_SUPERVISOR_LOOP_SCRIPT,
  DEFAULT_TESTER_CONFIG,
  DYNAMIC_LOOP_OWNED_FLAGS,
  KEEP_GOING_FLAG,
  LOG_ROOT_FLAG,
  MAX_CHUNKS_FLAG,
  MAX_CYCLES_FLAG,
  MAX_SUPERVISOR_COMMANDS_PER_DYNAMIC_CHUNK,
  MAX_TIMER_DELAY_SECONDS,
  OUT_DIR_FLAG,
  PREFLIGHT_SCRIPT_FLAG,
  PREFLIGHT_TIMEOUT_SECONDS_FLAG,
  SCENARIO_FLAG,
  SESSION_ROOT_FLAG,
  STABLE_LIMIT_FLAG,
  SUPERVISOR_LOOP_SCRIPT_FLAG,
  TESTER_CONFIG_FLAG,
  TESTER_SCENARIO_FLAG,
  type DynamicArgs,
  type DynamicNumberField,
  type DynamicOptionParser,
  type DynamicStringField,
  type ParsedDynamicOption,
} from "./model.ts";

const DYNAMIC_VALUE_OPTIONS = new Map<string, DynamicOptionParser>([
  [TESTER_CONFIG_FLAG, stringOption("testerConfig")],
  [PREFLIGHT_SCRIPT_FLAG, stringOption("preflightScript")],
  [SUPERVISOR_LOOP_SCRIPT_FLAG, stringOption("supervisorLoopScript")],
  [LOG_ROOT_FLAG, stringOption("logRoot")],
  [SESSION_ROOT_FLAG, stringOption("sessionRoot")],
  [MAX_CHUNKS_FLAG, positiveIntegerOption("maxChunks")],
  [CHUNK_MAX_RUNS_FLAG, positiveIntegerOption("chunkMaxRuns")],
  [STABLE_LIMIT_FLAG, positiveIntegerOption("stableLimit")],
  [CHUNK_BACKOFF_SECONDS_FLAG, nonNegativeTimerOption("chunkBackoffSeconds")],
  [BETWEEN_CHUNKS_SECONDS_FLAG, nonNegativeTimerOption("betweenChunksSeconds")],
  [CHILD_TIMEOUT_SECONDS_FLAG, positiveTimerOption("childTimeoutSeconds")],
  [COMMAND_TIMEOUT_SECONDS_FLAG, positiveIntegerOption("commandTimeoutSeconds")],
  [CHUNK_TIMEOUT_SECONDS_FLAG, chunkTimeoutOption],
  [PREFLIGHT_TIMEOUT_SECONDS_FLAG, positiveTimerOption("preflightTimeoutSeconds")],
]);
export function parseArgs(argv: readonly string[]): DynamicArgs {
  const args = defaultDynamicArgs();
  let chunkTimeoutSecondsExplicit = false;
  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    index += 1;
    if (arg === undefined) {
      break;
    }
    if (arg === "--") {
      args.supervisorArgs = argv.slice(index);
      break;
    }
    if (arg === "-h" || arg === "--help") {
      args.help = true;
      continue;
    }
    const parser = DYNAMIC_VALUE_OPTIONS.get(arg);
    if (parser !== undefined) {
      const parsed = parser(argv, index, arg);
      Object.assign(args, parsed.values);
      chunkTimeoutSecondsExplicit ||= parsed.chunkTimeoutSecondsExplicit === true;
      index = parsed.index + 1;
      continue;
    }
    if (arg === KEEP_GOING_FLAG) {
      args.keepGoing = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  validateSupervisorPassthrough(args.supervisorArgs);
  return validateDynamicTimeouts(args, chunkTimeoutSecondsExplicit);
}

function defaultDynamicArgs(): DynamicArgs {
  return {
    help: false,
    testerConfig: DEFAULT_TESTER_CONFIG,
    preflightScript: DEFAULT_PREFLIGHT_SCRIPT,
    supervisorLoopScript: DEFAULT_SUPERVISOR_LOOP_SCRIPT,
    chunkMaxRuns: DEFAULT_CHUNK_MAX_RUNS,
    stableLimit: DEFAULT_STABLE_LIMIT,
    chunkBackoffSeconds: DEFAULT_CHUNK_BACKOFF_SECONDS,
    betweenChunksSeconds: DEFAULT_BETWEEN_CHUNKS_SECONDS,
    childTimeoutSeconds: DEFAULT_CHILD_TIMEOUT_SECONDS,
    commandTimeoutSeconds: DEFAULT_COMMAND_TIMEOUT_SECONDS,
    chunkTimeoutSeconds: 0,
    preflightTimeoutSeconds: DEFAULT_PREFLIGHT_TIMEOUT_SECONDS,
    keepGoing: false,
    supervisorArgs: [],
  };
}

function stringOption(field: DynamicStringField): DynamicOptionParser {
  return (argv, index, flag) => ({
    index,
    values: { [field]: valueAfter(argv, index, flag) },
  });
}

function positiveIntegerOption(field: DynamicNumberField): DynamicOptionParser {
  return (argv, index, flag) => ({
    index,
    values: { [field]: parsePositiveInteger(valueAfter(argv, index, flag), flag) },
  });
}

function nonNegativeTimerOption(field: DynamicNumberField): DynamicOptionParser {
  return (argv, index, flag) => ({
    index,
    values: {
      [field]: parseNonNegativeTimerSeconds(valueAfter(argv, index, flag), flag),
    },
  });
}

function positiveTimerOption(field: DynamicNumberField): DynamicOptionParser {
  return (argv, index, flag) => ({
    index,
    values: { [field]: parsePositiveTimerSeconds(valueAfter(argv, index, flag), flag) },
  });
}

function chunkTimeoutOption(
  argv: readonly string[],
  index: number,
  flag: string,
): ParsedDynamicOption {
  return {
    index,
    chunkTimeoutSecondsExplicit: true,
    values: {
      chunkTimeoutSeconds: parsePositiveTimerSeconds(valueAfter(argv, index, flag), flag),
    },
  };
}

function validateSupervisorPassthrough(supervisorArgs: readonly string[]): void {
  const misplacedDynamicLoopFlag = firstMatchingFlag(
    supervisorArgs,
    DYNAMIC_LOOP_OWNED_FLAGS,
  );
  if (misplacedDynamicLoopFlag !== undefined) {
    throw new Error(
      `Do not pass dynamic-loop option ${misplacedDynamicLoopFlag} after --; put dynamic-loop options before --`,
    );
  }
  if (supervisorArgs.some(isOutDirArg)) {
    throw new Error(
      "Do not pass supervisor --out-dir; dynamic-loop owns the session chunk roots",
    );
  }
  const passthroughScenarioFlag = firstMatchingFlag(supervisorArgs, [
    SCENARIO_FLAG,
    TESTER_SCENARIO_FLAG,
  ]);
  if (passthroughScenarioFlag !== undefined) {
    throw new Error(
      `Do not pass supervisor ${passthroughScenarioFlag}; dynamic-loop runs tester-only chunks and selects tester scenarios from preflight balances`,
    );
  }
  if (firstMatchingFlag(supervisorArgs, [MAX_CYCLES_FLAG]) !== undefined) {
    throw new Error(
      "Do not pass supervisor --max-cycles; dynamic-loop owns one-cycle chunks",
    );
  }
}

function isOutDirArg(item: string): boolean {
  return item === OUT_DIR_FLAG || item.startsWith(`${OUT_DIR_FLAG}=`);
}

function validateDynamicTimeouts(
  args: DynamicArgs,
  chunkTimeoutSecondsExplicit: boolean,
): DynamicArgs {
  const minimumChildTimeoutSeconds = supervisorLoopChildTimeoutFloorSeconds(args);
  if (args.childTimeoutSeconds < minimumChildTimeoutSeconds) {
    throw new Error(
      `Invalid --child-timeout-seconds: expected at least ${String(minimumChildTimeoutSeconds)} seconds for --command-timeout-seconds ${String(args.commandTimeoutSeconds)}`,
    );
  }
  const minimumChunkTimeoutSeconds = supervisorLoopChunkTimeoutFloorSeconds(args);
  if (chunkTimeoutSecondsExplicit) {
    if (BigInt(args.chunkTimeoutSeconds) < minimumChunkTimeoutSeconds) {
      throw new Error(
        `Invalid --chunk-timeout-seconds: expected at least ${minimumChunkTimeoutSeconds.toString()} seconds for this chunk shape`,
      );
    }
    return args;
  }
  if (minimumChunkTimeoutSeconds > MAX_TIMER_DELAY_SECONDS) {
    throw new Error(
      `Invalid derived --chunk-timeout-seconds: expected at most ${String(maxTimerDelaySeconds())} seconds; lower --chunk-max-runs, --child-timeout-seconds, or --chunk-backoff-seconds`,
    );
  }
  return { ...args, chunkTimeoutSeconds: Number(minimumChunkTimeoutSeconds) };
}

export function usage(): string {
  return [
    "Usage: node scripts/supervisor/dynamic-loop-cli.ts [options]",
    "Options:",
    `  ${TESTER_CONFIG_FLAG} <ignored-json-config>  Default: ${DEFAULT_TESTER_CONFIG}`,
    `  --max-chunks <n>                      Default: unbounded`,
    `  --chunk-max-runs <n>                  Default: ${String(DEFAULT_CHUNK_MAX_RUNS)}`,
    `  --stable-limit <n>                    Default: ${String(DEFAULT_STABLE_LIMIT)}`,
    `  --chunk-backoff-seconds <n>           Default: ${String(DEFAULT_CHUNK_BACKOFF_SECONDS)}`,
    `  --between-chunks-seconds <n>          Default: ${String(DEFAULT_BETWEEN_CHUNKS_SECONDS)}`,
    `  --child-timeout-seconds <n>           Default: ${String(DEFAULT_CHILD_TIMEOUT_SECONDS)}`,
    `  --command-timeout-seconds <n>         Default: ${String(DEFAULT_COMMAND_TIMEOUT_SECONDS)}`,
    `  --chunk-timeout-seconds <n>           Default: derived from chunk-max-runs, child-timeout, and backoff`,
    `  --preflight-timeout-seconds <n>       Default: ${String(DEFAULT_PREFLIGHT_TIMEOUT_SECONDS)}`,
    "  --keep-going                         Continue after expected chunk stops; stop on incidents",
    `  --preflight-script <path>             Default: ${DEFAULT_PREFLIGHT_SCRIPT}`,
    `  --supervisor-loop-script <path>       Default: ${DEFAULT_SUPERVISOR_LOOP_SCRIPT}`,
    `  --log-root <path>                     Default: ${DEFAULT_LOG_ROOT}/`,
    `  ${SESSION_ROOT_FLAG} <path>                 Default: <log-root>/validation/dynamic-<time>-<pid>`,
    "  -h, --help",
    "  -- [supervisor-options]",
    "Dynamic-loop options must appear before --; supervisor --out-dir is owned by the dynamic loop.",
    "Checks source, reads tester preflight balance summaries, then runs bounded supervisor-loop chunks.",
  ].join("\n");
}

function supervisorLoopChunkTimeoutFloorSeconds(args: DynamicArgs): bigint {
  const cleanupGraceSeconds = BigInt(Math.ceil(TIMEOUT_KILL_GRACE_MS / 1000));
  return (
    BigInt(DEFAULT_SUPERVISOR_LOOP_PREBUILD_TIMEOUT_SECONDS) +
    BigInt(args.chunkMaxRuns) * BigInt(args.childTimeoutSeconds) +
    BigInt(Math.max(0, args.chunkMaxRuns - 1)) * BigInt(args.chunkBackoffSeconds) +
    BigInt(args.chunkMaxRuns + 1) * cleanupGraceSeconds +
    BigInt(DEFAULT_CHUNK_TIMEOUT_MARGIN_SECONDS)
  );
}

function supervisorLoopChildTimeoutFloorSeconds(args: DynamicArgs): number {
  return (
    args.commandTimeoutSeconds * MAX_SUPERVISOR_COMMANDS_PER_DYNAMIC_CHUNK +
    CHILD_COMMAND_TIMEOUT_MARGIN_SECONDS
  );
}

function firstMatchingFlag(
  args: readonly string[],
  flags: readonly string[],
): string | undefined {
  for (const arg of args) {
    for (const flag of flags) {
      if (arg === flag || arg.startsWith(`${flag}=`)) {
        return flag;
      }
    }
  }
  return undefined;
}

export function hasHelpFlag(args: readonly string[]): boolean {
  return args.some((arg) => arg === "-h" || arg === "--help");
}
