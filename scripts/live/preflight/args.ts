export type PreflightArgs = { help: true } | { help?: false; prefix: "BOT" | "TESTER" };

export function parseArgs(argv: readonly string[]): PreflightArgs {
  let prefix: "BOT" | "TESTER" | undefined;
  for (const arg of argv) {
    if (arg === "--") {
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      return { help: true };
    }
    if ((arg === "bot" || arg === "tester") && prefix === undefined) {
      prefix = arg === "bot" ? "BOT" : "TESTER";
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { prefix: prefix ?? "BOT" };
}

export function usage(): string {
  return "Usage: node scripts/live/preflight.ts [bot|tester]\nReads <ROLE>_CHAIN, <ROLE>_RPC_URL, and the key file named by <ROLE>_PRIVATE_KEY_FILE.";
}
