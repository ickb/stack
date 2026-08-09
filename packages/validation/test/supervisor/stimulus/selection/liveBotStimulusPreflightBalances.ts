import { describe, expect, it } from "vitest";
import {
  assertUnboundedBotLivePreflight,
  balancesFromPreflight,
} from "../../../../src/supervisor/stimulus/shared/liveBotStimulusTest.ts";
import { LIVE_BOT_STIMULUS_SUITE } from "../../support/stimulus/liveBotStimulus.ts";

describe(LIVE_BOT_STIMULUS_SUITE, () => {
  it("parses public preflight balances", () => {
    expect(
      balancesFromPreflight({
        balances: {
          CKB: { projectedAvailable: "223.00000001" },
          ICKB: { available: "45.5" },
        },
        capital: { depositCapacity: "118700.1" },
        system: { feeRate: "33222" },
      }),
    ).toEqual({
      depositCapacity: 11870010000000n,
      projectedCkb: 22300000001n,
      ickbAvailable: 4550000000n,
      feeRate: 33222n,
    });
  });

  it("requires unbounded bot live preflight evidence", () => {
    expect(() => {
      assertUnboundedBotLivePreflight({ bounded: true, maxIterations: 1 });
    }).toThrow("requires unbounded");
    expect(() => {
      assertUnboundedBotLivePreflight({ bounded: false });
    }).not.toThrow();
  });
});
