import { describe, expect, it } from "vitest";
import { chooseLiveBotStimulus } from "../../../../src/supervisor/stimulus/shared/liveBotStimulusTest.ts";
import {
  EXTRA_LARGE_LIMIT_ORDER,
  LIVE_BOT_STIMULUS_SUITE,
  balances,
  ckb,
} from "../../support/stimulus/liveBotStimulus.ts";

const ALL_CKB_LIMIT_ORDER = "all-ckb-limit-order";

describe(LIVE_BOT_STIMULUS_SUITE, () => {
  it("selects all-CKB stimulus from tester projected CKB", () => {
    expect(
      chooseLiveBotStimulus({
        requestedScenario: "auto",
        tester: balances({
          depositCapacity: 118_700n * ckb,
          projectedCkb: 3000n * ckb,
          feeRate: 33222n,
        }),
      }),
    ).toMatchObject({ scenario: ALL_CKB_LIMIT_ORDER });
  });

  it("bounds large tester CKB stimulus to two deposit capacities", () => {
    expect(
      chooseLiveBotStimulus({
        requestedScenario: "auto",
        tester: balances({
          depositCapacity: 118_700n * ckb,
          projectedCkb: 3_000_000n * ckb,
          feeRate: 33222n,
        }),
      }),
    ).toMatchObject({ scenario: EXTRA_LARGE_LIMIT_ORDER });
  });

  it("preserves explicit fee settings for CKB-to-iCKB stimulus", () => {
    expect(
      chooseLiveBotStimulus({
        requestedScenario: "auto",
        testerFee: "1",
        testerFeeBase: "1000",
        tester: balances({ projectedCkb: 3000n * ckb, feeRate: 33222n }),
      }),
    ).toMatchObject({
      scenario: ALL_CKB_LIMIT_ORDER,
      testerFee: "1",
      testerFeeBase: "1000",
    });
  });

  it("rejects explicit extra-large stimulus when tester CKB cannot fund it", () => {
    expect(() =>
      chooseLiveBotStimulus({
        requestedScenario: EXTRA_LARGE_LIMIT_ORDER,
        tester: balances({
          depositCapacity: 1000n * ckb,
          projectedCkb: 3001n * ckb,
          feeRate: 33222n,
        }),
      }),
    ).toThrow(`Explicit tester scenario ${EXTRA_LARGE_LIMIT_ORDER} is not fundable`);
  });

  it("rejects CKB-to-iCKB stimulus below tester reserve and order overhead", () => {
    expect(() =>
      chooseLiveBotStimulus({
        requestedScenario: "auto",
        testerFee: "1",
        testerFeeBase: "1000",
        tester: balances({ projectedCkb: 2000n * ckb, feeRate: 33222n }),
      }),
    ).toThrow("No tester stimulus is currently fundable");
  });
});
