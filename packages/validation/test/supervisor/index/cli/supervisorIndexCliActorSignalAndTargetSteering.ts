import { describe, expect, it } from "vitest";
import { main } from "../../../../src/supervisor/index.ts";
import {
  fakeChild,
  fakeHangingChild,
  fakeSuccessfulPreflightChild,
  ignoredChecker,
  isPreflightCommand,
  MAX_CYCLES_FLAG,
  missingStat,
  noopAsync,
  noopVoid,
  pathToString,
  RANDOM_ORDER_SCENARIO,
  realpathFixture,
  runSupervisorFixture,
  SCENARIO_FLAG,
  SDK_CONVERSION_SCENARIO,
  spawnFixture,
  SUPERVISOR_CLI_SUITE,
  TARGET_OUTCOME_FLAG,
  TEST_ACTOR_ENTRYPOINTS,
  TESTER_ENTRYPOINT,
  testerOrderStdout,
  txHash,
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

describe(SUPERVISOR_CLI_SUITE, () => {
  it("steers tester conversion coverage to the SDK conversion builder", async () => {
    const { exitCode, spawned } = await runSupervisorFixture(
      [
        "--out-dir",
        "log/live-supervisor/conversion-env-test",
        TARGET_OUTCOME_FLAG,
        "tester_conversion_created",
        MAX_CYCLES_FLAG,
        "1",
      ],
      (commandArgs) =>
        isPreflightCommand(commandArgs)
          ? fakeSuccessfulPreflightChild()
          : fakeChild(
              JSON.stringify({
                startTime: "now",
                actions: {
                  testerScenario: SDK_CONVERSION_SCENARIO,
                  conversion: { kind: "direct" },
                  cancelledOrders: 0,
                },
                txHash: txHash("15"),
                ElapsedSeconds: 1,
              }),
            ),
    );

    const tester = spawned.find((item) => item.args[0] === TESTER_ENTRYPOINT);
    expect(exitCode).toBe(0);
    expect(tester?.env).toMatchObject({
      TESTER_SCENARIO: SDK_CONVERSION_SCENARIO,
    });
  });
});

describe(SUPERVISOR_CLI_SUITE, () => {
  it("steers tester order coverage to a raw order builder", async () => {
    const { exitCode, spawned } = await runSupervisorFixture(
      [
        "--out-dir",
        "log/live-supervisor/order-env-test",
        TARGET_OUTCOME_FLAG,
        "tester_order_created",
        MAX_CYCLES_FLAG,
        "1",
      ],
      (commandArgs) =>
        isPreflightCommand(commandArgs)
          ? fakeSuccessfulPreflightChild()
          : fakeChild(testerOrderStdout({ txByte: "8a" })),
    );

    const tester = spawned.find((item) => item.args[0] === TESTER_ENTRYPOINT);
    expect(exitCode).toBe(0);
    expect(tester?.env).toMatchObject({
      TESTER_SCENARIO: RANDOM_ORDER_SCENARIO,
    });
  });
});
