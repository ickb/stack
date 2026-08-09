import {
  testerScenarioSelectionErrorText,
  testerScenarioSelectionListText,
} from "../../../testerContract.ts";
import {
  AUTO_SCENARIO,
  DEFAULT_BOT_LIVE_CONFIG,
  DEFAULT_COMMAND_TIMEOUT_SECONDS,
  DEFAULT_LOG_ROOT,
  DEFAULT_POLL_SECONDS,
  DEFAULT_PREFLIGHT_TIMEOUT_SECONDS,
  DEFAULT_TESTER_CONFIG,
  LIVE_BOT_STIMULUS_TESTER_SCENARIO_SELECTIONS,
  SESSION_ROOT_FLAG,
} from "./liveBotStimulusConstants.ts";
import type {
  LiveBotStimulusTesterScenarioSelection,
  ParsedStimulusArgs,
  StimulusArgHandler,
} from "./liveBotStimulusTypes.ts";

const liveBotStimulusTesterScenarioList = testerScenarioSelectionListText(
  LIVE_BOT_STIMULUS_TESTER_SCENARIO_SELECTIONS,
);

const liveBotStimulusTesterScenarioError = testerScenarioSelectionErrorText(
  LIVE_BOT_STIMULUS_TESTER_SCENARIO_SELECTIONS,
);

export function usage(): string {
  return [
    "Usage: live-bot-stimulus-test [options]",
    "Options:",
    `  --log-root <path>               Default: ${DEFAULT_LOG_ROOT}`,
    "  --session-root <path>           Default: <log-root>/validation/live-bot-stimulus-<time>-<pid>",
    "  --keep-going                    Run strictly serial cycles until SIGINT or SIGTERM",
    `  --bot-live-config <path>         Default: ${DEFAULT_BOT_LIVE_CONFIG}`,
    `  --tester-config <path>           Default: ${DEFAULT_TESTER_CONFIG}`,
    `  --tester-scenario ${liveBotStimulusTesterScenarioList}`,
    "  --tester-fee <n>                Optional tester raw-order fee numerator",
    "  --tester-fee-base <n>           Optional tester raw-order fee denominator",
    "  --wait-seconds <n>              Optional deadline; default waits until clear",
    `  --poll-seconds <n>              Default: ${String(DEFAULT_POLL_SECONDS)}`,
    `  --command-timeout-seconds <n>   Default: ${String(DEFAULT_COMMAND_TIMEOUT_SECONDS)}`,
    `  --preflight-timeout-seconds <n> Default: ${String(DEFAULT_PREFLIGHT_TIMEOUT_SECONDS)}`,
    "  -h, --help",
    "Creates one bounded tester order stimulus, then waits for its correlated bot match and an empty-order idle decision.",
  ].join("\n");
}

/**
 * Parses live bot stimulus CLI arguments into normalized session options.
 *
 * @remarks
 * A literal `--` is skipped and later flags are still parsed.
 */
export function parseArgs(argv: string[]): ParsedStimulusArgs {
  const args: ParsedStimulusArgs = {
    help: false,
    keepGoing: false,
    logRoot: DEFAULT_LOG_ROOT,
    botLiveConfig: DEFAULT_BOT_LIVE_CONFIG,
    testerConfig: DEFAULT_TESTER_CONFIG,
    testerScenario: AUTO_SCENARIO,
    pollSeconds: DEFAULT_POLL_SECONDS,
    commandTimeoutSeconds: DEFAULT_COMMAND_TIMEOUT_SECONDS,
    preflightTimeoutSeconds: DEFAULT_PREFLIGHT_TIMEOUT_SECONDS,
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
    const handler = stimulusArgHandler(arg);
    if (handler === undefined) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    index = handler(args, argv, index, arg) + 1;
  }
  if (args.keepGoing && args.sessionRoot !== undefined) {
    throw new Error("--keep-going cannot be combined with --session-root");
  }
  return args;
}

const STIMULUS_ARG_HANDLERS = new Map<string, StimulusArgHandler>([
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
    "--keep-going",
    (args, _argv, index): number => {
      Object.assign(args, { keepGoing: true });
      return index;
    },
  ],
  [
    "--log-root",
    (args, argv, index, flag): number => {
      Object.assign(args, { logRoot: valueAfter(argv, index + 1, flag) });
      return index + 1;
    },
  ],
  [
    SESSION_ROOT_FLAG,
    (args, argv, index, flag): number => {
      Object.assign(args, { sessionRoot: valueAfter(argv, index + 1, flag) });
      return index + 1;
    },
  ],
  [
    "--bot-live-config",
    (args, argv, index, flag): number => {
      Object.assign(args, { botLiveConfig: valueAfter(argv, index + 1, flag) });
      return index + 1;
    },
  ],
  [
    "--tester-config",
    (args, argv, index, flag): number => {
      Object.assign(args, { testerConfig: valueAfter(argv, index + 1, flag) });
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
        testerFee: parseUnsignedInteger(valueAfter(argv, index + 1, flag), flag),
      });
      return index + 1;
    },
  ],
  [
    "--tester-fee-base",
    (args, argv, index, flag): number => {
      Object.assign(args, {
        testerFeeBase: parsePositiveIntegerText(valueAfter(argv, index + 1, flag), flag),
      });
      return index + 1;
    },
  ],
  [
    "--wait-seconds",
    (args, argv, index, flag): number => {
      Object.assign(args, {
        waitSeconds: parsePositiveInteger(valueAfter(argv, index + 1, flag), flag),
      });
      return index + 1;
    },
  ],
  [
    "--poll-seconds",
    (args, argv, index, flag): number => {
      Object.assign(args, {
        pollSeconds: parsePositiveInteger(valueAfter(argv, index + 1, flag), flag),
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
  [
    "--preflight-timeout-seconds",
    (args, argv, index, flag): number => {
      Object.assign(args, {
        preflightTimeoutSeconds: parsePositiveInteger(
          valueAfter(argv, index + 1, flag),
          flag,
        ),
      });
      return index + 1;
    },
  ],
]);

function stimulusArgHandler(arg: string): StimulusArgHandler | undefined {
  return STIMULUS_ARG_HANDLERS.get(arg);
}

function parseTesterScenario(value: string): LiveBotStimulusTesterScenarioSelection {
  const scenario = LIVE_BOT_STIMULUS_TESTER_SCENARIO_SELECTIONS.find(
    (candidate) => candidate === value,
  );
  if (scenario !== undefined) {
    return scenario;
  }
  throw new Error(
    `Invalid --tester-scenario: expected ${liveBotStimulusTesterScenarioError}`,
  );
}

function parsePositiveInteger(value: string, flag: string): number {
  const text = parsePositiveIntegerText(value, flag);
  const parsed = BigInt(text);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Invalid ${flag}: expected a safe integer`);
  }
  return Number(parsed);
}

function parsePositiveIntegerText(value: string, flag: string): string {
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error(`Invalid ${flag}: expected a positive integer`);
  }
  return value;
}

function parseUnsignedInteger(value: string, flag: string): string {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error(`Invalid ${flag}: expected an unsigned integer`);
  }
  return value;
}

function valueAfter(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}
