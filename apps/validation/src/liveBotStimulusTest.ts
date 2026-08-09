import { liveBotStimulusMain, main as runSupervisorMain } from "@ickb/validation";
import { pathToFileURL } from "node:url";

export const actorEntrypoints = {
  bot: "apps/bot/src/index.ts",
  tester: "apps/validation/src/tester.ts",
} as const;

const supervisorDependencies = { actorEntrypoints };

export type LiveBotStimulusMain = typeof liveBotStimulusMain;
export type RunSupervisorMain = typeof runSupervisorMain;

const defaultDependencies = { liveBotStimulusMain, runSupervisorMain };

export async function runLiveBotStimulusEntrypoint(
  argv: string[] = process.argv,
  moduleUrl: string = import.meta.url,
  run: (argv: string[]) => Promise<number> = runLiveBotStimulusCli,
): Promise<void> {
  if (moduleUrl !== pathToFileURL(argv[1] ?? "").href) {
    return;
  }

  process.exitCode = await run(argv.slice(2));
}

export async function runLiveBotStimulusCli(
  argv: string[] = process.argv.slice(2),
  dependencies: {
    liveBotStimulusMain: LiveBotStimulusMain;
    runSupervisorMain: RunSupervisorMain;
  } = defaultDependencies,
): Promise<number> {
  return dependencies.liveBotStimulusMain(argv, {
    runSupervisor: async (supervisorArgv, io) =>
      dependencies.runSupervisorMain(supervisorArgv, supervisorDependencies, io),
  });
}

// eslint-disable-next-line unicorn/no-top-level-side-effects -- CLI module runs only when imported as the process entrypoint.
await runLiveBotStimulusEntrypoint();
