import { main } from "@ickb/validation";
import { pathToFileURL } from "node:url";

export const actorEntrypoints = {
  bot: "apps/bot/src/index.ts",
  tester: "apps/validation/src/tester.ts",
} as const;

type SupervisorMain = typeof main;

export async function runSupervisorEntrypoint(
  argv: string[] = process.argv,
  moduleUrl: string = import.meta.url,
  run: (argv: string[]) => Promise<number> = runSupervisorCli,
): Promise<void> {
  if (argv[1] === undefined || moduleUrl !== pathToFileURL(argv[1]).href) {
    return;
  }

  process.exitCode = await run(argv.slice(2));
}

export async function runSupervisorCli(
  argv: string[] = process.argv.slice(2),
  runMain: SupervisorMain = main,
): Promise<number> {
  return runMain(argv, { actorEntrypoints });
}

// eslint-disable-next-line unicorn/no-top-level-side-effects -- CLI module runs only when imported as the process entrypoint.
await runSupervisorEntrypoint();
