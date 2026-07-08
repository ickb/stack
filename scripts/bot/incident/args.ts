import { isAsciiDigits } from "./model/text.ts";
import type { CollectorRunArgs, ParsedCollectorArgs } from "./model/types.ts";

type RelativeTimeUnit = "d" | "h" | "m" | "ms" | "s";

interface ParsedOption {
  args: Partial<CollectorRunArgs>;
  index: number;
}

const relativeTimeMultipliers: Record<RelativeTimeUnit, number> = {
  d: 86_400_000,
  h: 3_600_000,
  m: 60_000,
  ms: 1,
  s: 1_000,
};
const relativeTimeUnits: readonly RelativeTimeUnit[] = ["ms", "s", "m", "h", "d"];

export function usage(): string {
  return [
    "Usage: node --experimental-default-type=module scripts/bot/collect-incident.ts [--log-root PATH] [--log-dir PATH] --since <iso|relative> --until <iso|relative>",
    "Relative times use the current time, for example --since 2h --until now.",
  ].join("\n");
}

export function parseArgs(argv: readonly string[]): ParsedCollectorArgs {
  let args: Partial<CollectorRunArgs> = {};
  let index = 0;
  while (index < argv.length) {
    const arg = argv[index] ?? "";
    if (arg === "--") {
      index += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      return { help: true };
    }
    const parsed = parseOption(argv, index, arg, args);
    args = parsed.args;
    index = parsed.index + 1;
  }

  if (args.since === undefined) {
    throw new Error("Missing required --since");
  }
  if (args.until === undefined) {
    throw new Error("Missing required --until");
  }

  return omitUndefinedOptions({
    logDir: args.logDir,
    logRoot: args.logRoot,
    since: args.since,
    until: args.until,
  });
}

export function parseTimeBound(value: string, now: Date): Date {
  if (value === "now") {
    return new Date(now);
  }

  const relativeOffsetMs = parseRelativeOffsetMs(value);
  if (relativeOffsetMs !== null) {
    const timestamp = now.getTime() - relativeOffsetMs;
    if (!Number.isFinite(timestamp)) {
      throw new TypeError(`Invalid time bound: ${value}`);
    }
    return new Date(timestamp);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`Invalid time bound: ${value}`);
  }
  return parsed;
}

function omitUndefinedOptions(args: CollectorRunArgs): CollectorRunArgs {
  return {
    ...(args.logDir === undefined ? {} : { logDir: args.logDir }),
    ...(args.logRoot === undefined ? {} : { logRoot: args.logRoot }),
    since: args.since,
    until: args.until,
  };
}

function parseOption(
  argv: readonly string[],
  index: number,
  option: string,
  args: Partial<CollectorRunArgs>,
): ParsedOption {
  switch (option) {
    case "--log-root": {
      const value = requireValue(argv, index + 1, option);
      return { args: { ...args, logRoot: value }, index: index + 1 };
    }
    case "--log-dir": {
      const value = requireValue(argv, index + 1, option);
      return { args: { ...args, logDir: value }, index: index + 1 };
    }
    case "--since": {
      const value = requireValue(argv, index + 1, option);
      return { args: { ...args, since: value }, index: index + 1 };
    }
    case "--until": {
      const value = requireValue(argv, index + 1, option);
      return { args: { ...args, until: value }, index: index + 1 };
    }
    default: {
      throw new Error(`Unknown option: ${option}`);
    }
  }
}

function requireValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined || value === "" || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function parseRelativeOffsetMs(value: string): number | null {
  const relativeValue = stripOptionalAgo(value);
  const unit = relativeTimeUnits.find((candidate) => relativeValue.endsWith(candidate));
  if (unit === undefined) {
    return null;
  }
  const amountText = relativeValue.slice(0, -unit.length);
  if (amountText === "" || !isAsciiDigits(amountText)) {
    return null;
  }
  const amount = Number(amountText);
  if (!Number.isSafeInteger(amount)) {
    return null;
  }
  return amount * relativeTimeMultipliers[unit];
}

function stripOptionalAgo(value: string): string {
  if (!value.endsWith("ago")) {
    return value;
  }
  const beforeAgo = value.slice(0, -"ago".length);
  const stripped = beforeAgo.trimEnd();
  return stripped.length < beforeAgo.length ? stripped : value;
}
