export type PreflightArgs =
  { configPath?: string; help: true } | { configPath: string; help?: false };

export function parseArgs(argv: readonly string[]): PreflightArgs {
  const args: { configPath?: string; help?: true } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      throw new Error("Missing argument");
    }
    if (arg === "--") {
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      args.help = true;
      continue;
    }
    if (arg === "--config") {
      args.configPath = valueAfter(argv, ++index, arg);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.help) {
    return {
      ...(args.configPath === undefined ? {} : { configPath: args.configPath }),
      help: true,
    };
  }

  if (args.configPath === undefined) {
    throw new Error("Missing required --config <path>");
  }

  return { configPath: args.configPath };
}

export function usage(): string {
  return "Usage: node scripts/live/preflight.ts --config <ignored-json-config>";
}

function valueAfter(argv: readonly string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}
