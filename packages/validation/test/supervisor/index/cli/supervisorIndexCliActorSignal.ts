import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../../../src/supervisor/index.ts";
import {
  fakeHangingChild,
  fakeSuccessfulPreflightChild,
  ignoredChecker,
  isPreflightCommand,
  MAX_CYCLES_FLAG,
  noopVoid,
  SCENARIO_FLAG,
  spawnFixture,
  SUPERVISOR_CLI_SUITE,
  TEST_ACTOR_ENTRYPOINTS,
} from "../../support/supervisor/index.ts";

const { join } = path;

describe(SUPERVISOR_CLI_SUITE, () => {
  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)(
    "preserves %s while cleaning up the active actor",
    async (expectedSignal, exitCode) => {
      let signalHandler: (() => void) | undefined;
      const kills: Array<{ pid: number; signal: NodeJS.Signals }> = [];
      const child = fakeHangingChild();
      const root = await mkdtemp(join(tmpdir(), "ickb-supervisor-signal-"));
      const run = main(
        [
          "--out-dir",
          join(root, "validation", "signal", "chunks", "chunk-0001", "run-0001"),
          SCENARIO_FLAG,
          "bot-only",
          MAX_CYCLES_FLAG,
          "1",
        ],
        {
          actorEntrypoints: TEST_ACTOR_ENTRYPOINTS,
          processOn: (signal, listener) => {
            if (signal === expectedSignal) {
              signalHandler = (): void => {
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
        },
      );

      await expect(run).resolves.toBe(exitCode);
      expect(kills).toEqual([{ pid: -1234, signal: expectedSignal }]);
    },
  );
});
