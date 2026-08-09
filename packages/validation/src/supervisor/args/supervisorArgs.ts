import {
  DEFAULT_BOT_CONFIG_PATH,
  DEFAULT_COMMAND_TIMEOUT_SECONDS,
  DEFAULT_TESTER_CONFIG_PATH,
  isTesterScenarioSelection,
  OUTCOME_KINDS,
  SCENARIO_NAMES,
  TESTER_SCENARIO_SELECTIONS,
  testerScenarioSelectionErrorText,
  testerScenarioSelectionListText,
  type OutcomeKind,
  type ScenarioName,
  type TesterScenarioSelection,
} from "../runtime/shared/supervisorConstants.ts";
import type { ParsedArgHandler, ParsedArgs } from "../runtime/shared/supervisorTypes.ts";

const testerScenarioList = testerScenarioSelectionListText(TESTER_SCENARIO_SELECTIONS);
const testerScenarioError = testerScenarioSelectionErrorText(TESTER_SCENARIO_SELECTIONS);

export function usage(): string {
  return [
    "Usage: supervisor [options]",
    "Options:",
    `  --bot-config <ignored-json-config>     Default: ${DEFAULT_BOT_CONFIG_PATH}`,
    `  --tester-config <ignored-json-config>  Default: ${DEFAULT_TESTER_CONFIG_PATH}`,
    "  --out-dir <ignored-dir>              Default: log/live-supervisor/<run-id>",
    "  --max-cycles <n>                    Default: 1",
    "  --max-wall-clock-seconds <n>",
    "  --stop-after-tx-count <n>",
    "  --scenario auto|standard-cycle|tester-only|bot-only|tester-fresh-skip-two-pass",
    `  --tester-scenario ${testerScenarioList}`,
    "  --tester-fee <n>                    Default: 1",
    "  --tester-fee-base <n>               Default: 100000",
    "  --target-outcome <outcome>           Repeatable; planner prefers these first",
    "  --command-timeout-seconds <n>        Default: 900",
    "  --dry-run                           Fixture-only run; no live configs required",
    "  -h, --help",
  ].join("\n");
}

/**
 * Parses supervisor CLI arguments into the normalized execution options.
 *
 * @remarks
 * A literal `--` is skipped and later flags are still parsed. Help and dry-run
 * modes clear config paths so they do not require live ignored config files.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    help: false,
    dryRun: false,
    botConfigPath: DEFAULT_BOT_CONFIG_PATH,
    testerConfigPath: DEFAULT_TESTER_CONFIG_PATH,
    maxCycles: 1,
    scenario: "auto",
    targetOutcomes: [],
    commandTimeoutSeconds: DEFAULT_COMMAND_TIMEOUT_SECONDS,
  };

  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    if (arg === undefined) {
      throw new Error(`Missing argument at index ${String(index)}`);
    }
    if (arg === "--") {
      index += 1;
      continue;
    }
    const handler = parsedArgHandler(arg);
    if (handler === undefined) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    index = handler(args, argv, index, arg) + 1;
  }

  if (args.help || args.dryRun) {
    Object.assign(args, { botConfigPath: undefined, testerConfigPath: undefined });
  }
  return args;
}

const PARSED_ARG_HANDLERS = new Map<string, ParsedArgHandler>([
  [
    "-h",
    (args, _argv, index): number => {
      Object.assign(args, { help: true });
      return index;
    },
  ],
  [
    "--help",
    (args, _argv, index): number => {
      Object.assign(args, { help: true });
      return index;
    },
  ],
  [
    "--dry-run",
    (args, _argv, index): number => {
      Object.assign(args, { dryRun: true });
      return index;
    },
  ],
  [
    "--bot-config",
    (args, argv, index, flag): number => {
      Object.assign(args, { botConfigPath: valueAfter(argv, index + 1, flag) });
      return index + 1;
    },
  ],
  [
    "--tester-config",
    (args, argv, index, flag): number => {
      Object.assign(args, { testerConfigPath: valueAfter(argv, index + 1, flag) });
      return index + 1;
    },
  ],
  [
    "--out-dir",
    (args, argv, index, flag): number => {
      Object.assign(args, { outDir: valueAfter(argv, index + 1, flag) });
      return index + 1;
    },
  ],
  [
    "--max-cycles",
    (args, argv, index, flag): number => {
      Object.assign(args, {
        maxCycles: parsePositiveInteger(valueAfter(argv, index + 1, flag), flag),
      });
      return index + 1;
    },
  ],
  [
    "--max-wall-clock-seconds",
    (args, argv, index, flag): number => {
      Object.assign(args, {
        maxWallClockSeconds: parsePositiveInteger(
          valueAfter(argv, index + 1, flag),
          flag,
        ),
      });
      return index + 1;
    },
  ],
  [
    "--stop-after-tx-count",
    (args, argv, index, flag): number => {
      Object.assign(args, {
        stopAfterTxCount: parsePositiveInteger(valueAfter(argv, index + 1, flag), flag),
      });
      return index + 1;
    },
  ],
  [
    "--scenario",
    (args, argv, index, flag): number => {
      Object.assign(args, {
        scenario: parseScenarioName(valueAfter(argv, index + 1, flag)),
      });
      return index + 1;
    },
  ],
  [
    "--target-outcome",
    (args, argv, index, flag): number => {
      Object.assign(args, {
        targetOutcomes: [
          ...args.targetOutcomes,
          parseOutcome(valueAfter(argv, index + 1, flag), flag),
        ],
      });
      return index + 1;
    },
  ],
  [
    "--tester-scenario",
    (args, argv, index, flag): number => {
      Object.assign(args, {
        testerScenario: parseTesterScenario(valueAfter(argv, index + 1, flag)),
      });
      return index + 1;
    },
  ],
  [
    "--tester-fee",
    (args, argv, index, flag): number => {
      Object.assign(args, {
        testerFee: parseTesterFeeValue(valueAfter(argv, index + 1, flag), flag),
      });
      return index + 1;
    },
  ],
  [
    "--tester-fee-base",
    (args, argv, index, flag): number => {
      Object.assign(args, {
        testerFeeBase: parseTesterFeeValue(valueAfter(argv, index + 1, flag), flag),
      });
      return index + 1;
    },
  ],
  [
    "--command-timeout-seconds",
    (args, argv, index, flag): number => {
      Object.assign(args, {
        commandTimeoutSeconds: parsePositiveInteger(
          valueAfter(argv, index + 1, flag),
          flag,
        ),
      });
      return index + 1;
    },
  ],
]);

function parsedArgHandler(arg: string): ParsedArgHandler | undefined {
  return PARSED_ARG_HANDLERS.get(arg);
}

function parseOutcome(value: string, flag: string): OutcomeKind {
  const outcome = OUTCOME_KINDS.find((candidate) => candidate === value);
  if (outcome !== undefined) {
    return outcome;
  }
  throw new Error(`Invalid ${flag}: unknown outcome ${value}`);
}

function parseScenarioName(value: string): ScenarioName {
  const scenario = SCENARIO_NAMES.find((candidate) => candidate === value);
  if (scenario !== undefined) {
    return scenario;
  }
  throw new Error(
    "Invalid --scenario: expected auto, standard-cycle, tester-only, bot-only, or tester-fresh-skip-two-pass",
  );
}

function parseTesterScenario(value: string): TesterScenarioSelection {
  if (isTesterScenarioSelection(value)) {
    return value;
  }
  throw new Error(`Invalid --tester-scenario: expected ${testerScenarioError}`);
}

function valueAfter(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function parsePositiveInteger(value: string, flag: string): number {
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error(`Invalid ${flag}: expected a positive integer`);
  }
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Invalid ${flag}: expected a safe integer`);
  }
  return Number(parsed);
}

function parseTesterFeeValue(value: string, flag: string): string {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error(`Invalid ${flag}: expected an unsigned integer`);
  }
  return value;
}
