import type { ParsedLauncherArgs } from "./runtime/types.ts";

export function usage(): string {
  return `Usage: node --experimental-default-type=module scripts/bot/launcher.ts [--log-root PATH] [--log-dir PATH] [--log-storage-quota-bytes N] [--no-child-tee] [-- <command> [args...]]\n`;
}

export function parseArgs(argv: readonly string[]): ParsedLauncherArgs {
  if (argv.includes("-h") || argv.includes("--help")) {
    return { help: true };
  }

  const separator = argv.indexOf("--");
  const command = separator === -1 ? [] : argv.slice(separator + 1);

  if (separator !== -1 && (command.length === 0 || command[0] === "")) {
    throw new Error("Missing child command after --");
  }

  const options = separator === -1 ? argv : argv.slice(0, separator);
  const parsed = parseLauncherOptions(options);

  return {
    ...parsed,
    command: command[0],
    commandArgs: command.slice(1),
  };
}

export function parseOptionalPositiveSafeInteger(
  value: string | undefined,
  label: string,
): number | undefined {
  return value === undefined ? undefined : parsePositiveSafeInteger(value, label);
}

function parseLauncherOptions(
  options: readonly string[],
): Omit<Exclude<ParsedLauncherArgs, { help: true }>, "command" | "commandArgs"> {
  let logRoot: string | undefined;
  let logDir: string | undefined;
  let logStorageQuotaBytes: number | undefined;
  let teeChildOutput = true;

  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    switch (option) {
      case undefined: {
        throw new Error("Unknown option: ");
      }
      case "--log-root": {
        logRoot = requireValue(options, index, option);
        index += 1;
        break;
      }
      case "--log-dir": {
        logDir = requireValue(options, index, option);
        index += 1;
        break;
      }
      case "--log-storage-quota-bytes": {
        logStorageQuotaBytes = parsePositiveSafeInteger(
          requireValue(options, index, option),
          option,
        );
        index += 1;
        break;
      }
      case "--no-child-tee": {
        teeChildOutput = false;
        break;
      }
      default: {
        throw new Error(`Unknown option: ${option}`);
      }
    }
  }

  return { logDir, logRoot, logStorageQuotaBytes, teeChildOutput };
}

function requireValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (value === undefined || value === "" || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function parsePositiveSafeInteger(value: string, label: string): number {
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error(`Invalid ${label}: expected a positive integer`);
  }
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Invalid ${label}: expected a safe integer`);
  }
  return Number(parsed);
}
