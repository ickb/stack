import {
  parseNonNegativeTimerSeconds,
  parsePositiveInteger,
  parsePositiveTimerSeconds,
  valueAfter,
} from "../helpers.ts";
import {
  DEFAULT_BACKOFF_SECONDS,
  DEFAULT_CHILD_TIMEOUT_SECONDS,
  DEFAULT_MAX_RUNS,
  DEFAULT_STABLE_LIMIT,
  DEFAULT_SUPERVISOR_SCRIPT,
  LOOP_OWNED_FLAGS,
  SUPERVISOR_OUTPUT_ROOT,
  type LoopArgs,
  type ParsedLoopOption,
} from "./model.ts";

export function parseArgs(argv: readonly string[]): LoopArgs {
  const args: LoopArgs = {
    help: false,
    maxRuns: DEFAULT_MAX_RUNS,
    stableLimit: DEFAULT_STABLE_LIMIT,
    backoffSeconds: DEFAULT_BACKOFF_SECONDS,
    childTimeoutSeconds: DEFAULT_CHILD_TIMEOUT_SECONDS,
    supervisorScript: DEFAULT_SUPERVISOR_SCRIPT,
    supervisorArgs: [],
  };
  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    if (arg === undefined) {
      break;
    }
    if (arg === "--") {
      args.supervisorArgs = argv.slice(index + 1);
      break;
    }
    const parsedOption = parseLoopOption(argv, index, arg);
    if (parsedOption !== undefined) {
      Object.assign(args, parsedOption.values);
      index = parsedOption.index + 1;
      continue;
    }
    throw new Error(`Unknown argument before --: ${arg}`);
  }
  validateSupervisorArgs(args.supervisorArgs);
  return args;
}

function parseLoopOption(
  argv: readonly string[],
  index: number,
  arg: string,
): ParsedLoopOption | undefined {
  if (arg === "-h" || arg === "--help") {
    return { index, values: { help: true } };
  }
  if (arg === "--out-root") {
    return { index: index + 1, values: { outRoot: valueAfter(argv, index + 1, arg) } };
  }
  if (arg === "--max-runs") {
    return {
      index: index + 1,
      values: { maxRuns: parsePositiveInteger(valueAfter(argv, index + 1, arg), arg) },
    };
  }
  if (arg === "--stable-limit") {
    return {
      index: index + 1,
      values: {
        stableLimit: parsePositiveInteger(valueAfter(argv, index + 1, arg), arg),
      },
    };
  }
  if (arg === "--backoff-seconds") {
    return {
      index: index + 1,
      values: {
        backoffSeconds: parseNonNegativeTimerSeconds(
          valueAfter(argv, index + 1, arg),
          arg,
        ),
      },
    };
  }
  if (arg === "--child-timeout-seconds") {
    return {
      index: index + 1,
      values: {
        childTimeoutSeconds: parsePositiveTimerSeconds(
          valueAfter(argv, index + 1, arg),
          arg,
        ),
      },
    };
  }
  if (arg === "--supervisor-script") {
    return {
      index: index + 1,
      values: { supervisorScript: valueAfter(argv, index + 1, arg) },
    };
  }
  return undefined;
}

function validateSupervisorArgs(supervisorArgs: readonly string[]): void {
  const misplacedLoopFlag = firstMatchingFlag(supervisorArgs, LOOP_OWNED_FLAGS);
  if (misplacedLoopFlag !== undefined) {
    throw new Error(
      `Do not pass loop option ${misplacedLoopFlag} after --; put loop options before --`,
    );
  }
  if (
    supervisorArgs.some((item) => item === "--out-dir" || item.startsWith("--out-dir="))
  ) {
    throw new Error("Do not pass supervisor --out-dir; use loop --out-root instead");
  }
}

export function usage(): string {
  return [
    "Usage: node scripts/supervisor/loop-cli.ts [loop-options] -- [supervisor-options]",
    "Loop options:",
    `  --out-root <dir>               Default: ${SUPERVISOR_OUTPUT_ROOT}/loop-<time>-<pid>`,
    `  --max-runs <n>                 Default: ${String(DEFAULT_MAX_RUNS)}`,
    `  --stable-limit <n>             Default: ${String(DEFAULT_STABLE_LIMIT)}`,
    `  --backoff-seconds <n>          Default: ${String(DEFAULT_BACKOFF_SECONDS)}`,
    `  --child-timeout-seconds <n>    Default: ${String(DEFAULT_CHILD_TIMEOUT_SECONDS)}`,
    `  --supervisor-script <path>     Default: ${DEFAULT_SUPERVISOR_SCRIPT}`,
    "  -h, --help",
    "Checks source, then reads only each child run summary.json.",
    "Loop options must appear before --; supervisor --out-dir is owned by the loop.",
  ].join("\n");
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
