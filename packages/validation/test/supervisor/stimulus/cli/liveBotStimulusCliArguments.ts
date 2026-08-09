import { describe, expect, it } from "vitest";
import {
  liveBotStimulusMain,
  parseArgs,
  usage,
} from "../../../../src/supervisor/stimulus/shared/liveBotStimulusTest.ts";
import {
  BOUNDED_ICKB_TO_CKB_LIMIT_ORDER,
  EXTRA_LARGE_LIMIT_ORDER,
  LIVE_BOT_STIMULUS_SUITE,
  expectParsedArgs,
} from "../../support/stimulus/liveBotStimulus.ts";

const TESTER_SCENARIO_FLAG = "--tester-scenario";
const KEEP_GOING_FLAG = "--keep-going";
const SESSION_ROOT_FLAG = "--session-root";
const UNBOUNDED_ICKB_TO_CKB_LIMIT_ORDER = "ickb-to-ckb-limit-order";

describe(LIVE_BOT_STIMULUS_SUITE, () => {
  it("parses CLI arguments", () => {
    const args = parseArgs([
      "--log-root",
      "log/custom",
      SESSION_ROOT_FLAG,
      "log/custom/validation/manual",
      "--bot-live-config",
      "config/bot-live.json",
      "--tester-config",
      "config/tester.json",
      TESTER_SCENARIO_FLAG,
      BOUNDED_ICKB_TO_CKB_LIMIT_ORDER,
      "--tester-fee",
      "1",
      "--tester-fee-base",
      "1000",
      "--wait-seconds",
      "12",
      "--poll-seconds",
      "3",
      "--command-timeout-seconds",
      "99",
      "--preflight-timeout-seconds",
      "7",
    ]);

    expectParsedArgs(args);
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs([]).waitSeconds).toBeUndefined();
    expect(parseArgs([KEEP_GOING_FLAG]).keepGoing).toBe(true);
    expect(() =>
      parseArgs([KEEP_GOING_FLAG, SESSION_ROOT_FLAG, "log/validation/manual"]),
    ).toThrow("--keep-going cannot be combined with --session-root");
    expect(parseArgs(["--", "--log-root", "log"]).logRoot).toBe("log");
    expect(
      parseArgs([TESTER_SCENARIO_FLAG, EXTRA_LARGE_LIMIT_ORDER]).testerScenario,
    ).toBe(EXTRA_LARGE_LIMIT_ORDER);
    expect(usage()).toContain(KEEP_GOING_FLAG);
    expect(usage()).toContain(BOUNDED_ICKB_TO_CKB_LIMIT_ORDER);
    expect(() =>
      parseArgs([TESTER_SCENARIO_FLAG, UNBOUNDED_ICKB_TO_CKB_LIMIT_ORDER]),
    ).toThrow("Invalid --tester-scenario");
    expect(() => parseArgs([TESTER_SCENARIO_FLAG, "random-order"])).toThrow(
      "Invalid --tester-scenario",
    );
  });

  it("forwards signals while a one-shot session waits", async () => {
    const handlers = new Map<NodeJS.Signals, () => void>();
    const status = await liveBotStimulusMain(
      [],
      {
        runSupervisor: async () => {
          await Promise.resolve();
          return 0;
        },
        addSignalHandler: (signal, handler) => handlers.set(signal, handler),
        removeSignalHandler: (signal) => handlers.delete(signal),
      },
      {},
      async ({ dependencies }) => {
        handlers.get("SIGINT")?.();
        expect(dependencies.receivedSignal?.()).toBe("SIGINT");
        await Promise.resolve();
        return 0;
      },
    );

    expect(status).toBe(130);
    expect(handlers.size).toBe(0);
  });
});
