import { describe, expect, it } from "vitest";
import { main } from "../../../../src/supervisor/index.ts";
import {
  fakeHangingChild,
  fakeSuccessfulPreflightChild,
  ignoredChecker,
  isPreflightCommand,
  MAX_CYCLES_FLAG,
  missingStat,
  noopAsync,
  noopVoid,
  pathToString,
  realpathFixture,
  SCENARIO_FLAG,
  spawnFixture,
  SUPERVISOR_CLI_SUITE,
  TEST_ACTOR_ENTRYPOINTS,
} from "../../support/supervisor/index.ts";

describe(SUPERVISOR_CLI_SUITE, () => {
  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)(
    "preserves %s while cleaning up the active actor",
    async (expectedSignal, exitCode) => {
      let signalHandler: (() => void) | undefined;
      let signaled = false;
      const kills: Array<{ pid: number; signal: NodeJS.Signals }> = [];
      const child = fakeHangingChild();
      const run = main(
        [
          "--out-dir",
          "log/live-supervisor/signal-forwarding-test",
          SCENARIO_FLAG,
          "bot-only",
          MAX_CYCLES_FLAG,
          "1",
        ],
        {
          actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
          skipBuiltRuntimeCheck: true,
          processOn: (signal, listener) => {
            if (signal === expectedSignal) {
              signalHandler = (): void => {
                signaled = true;
                listener();
              };
            }
          },
          processOff: noopVoid,
          killProcess: (pid, signal) => {
            kills.push({ pid, signal });
            if (signal === expectedSignal) {
              queueMicrotask(() => {
                child.emit("close", null, expectedSignal);
              });
            }
          },
          spawnCommand: spawnFixture((_command, commandArgs) => {
            if (isPreflightCommand(commandArgs)) {
              return fakeSuccessfulPreflightChild();
            }
            queueMicrotask(() => signalHandler?.());
            return child;
          }),
          spawnSyncCommand: ignoredChecker(true),
          lstat: missingStat,
          stat: missingStat,
          mkdir: noopAsync,
          realpath: realpathFixture((path) => pathToString(path)),
          appendFile: noopAsync,
          writeFile: async () => {
            await Promise.resolve();
            if (signaled) {
              throw new Error("cleanup artifact failed");
            }
          },
        },
      );

      await expect(run).resolves.toBe(exitCode);
      expect(kills).toEqual([{ pid: -1234, signal: expectedSignal }]);
    },
  );
});
