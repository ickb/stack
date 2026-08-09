import { describe, expect, it } from "vitest";
import { chooseLiveBotStimulus } from "../../../../src/supervisor/stimulus/shared/liveBotStimulusTest.ts";
import {
  BOUNDED_ICKB_TO_CKB_LIMIT_ORDER,
  LIVE_BOT_STIMULUS_SUITE,
  balances,
  ckb,
} from "../../support/stimulus/liveBotStimulus.ts";

const NO_FUNDABLE_STIMULUS = "No tester stimulus is currently fundable";

describe(LIVE_BOT_STIMULUS_SUITE, () => {
  it("selects bounded iCKB-to-CKB stimulus from tester funds only", () => {
    const tester = balances({
      projectedCkb: 1999n * ckb,
      ickbAvailable: 100n * ckb,
      feeRate: 33222n,
    });

    expect(chooseLiveBotStimulus({ requestedScenario: "auto", tester })).toMatchObject({
      scenario: BOUNDED_ICKB_TO_CKB_LIMIT_ORDER,
      testerFee: "1",
      testerFeeBase: "1000",
    });
    expect(
      chooseLiveBotStimulus({
        requestedScenario: BOUNDED_ICKB_TO_CKB_LIMIT_ORDER,
        tester,
      }),
    ).toMatchObject({ scenario: BOUNDED_ICKB_TO_CKB_LIMIT_ORDER });
  });

  it("rejects bounded iCKB-to-CKB stimulus below its tester iCKB minimum", () => {
    const tester = balances({
      projectedCkb: 1999n * ckb,
      ickbAvailable: 100n * ckb - 1n,
      feeRate: 33222n,
    });

    expect(() => chooseLiveBotStimulus({ requestedScenario: "auto", tester })).toThrow(
      NO_FUNDABLE_STIMULUS,
    );
    expect(() =>
      chooseLiveBotStimulus({
        requestedScenario: BOUNDED_ICKB_TO_CKB_LIMIT_ORDER,
        tester,
      }),
    ).toThrow(`Explicit tester scenario ${BOUNDED_ICKB_TO_CKB_LIMIT_ORDER}`);
  });
});
