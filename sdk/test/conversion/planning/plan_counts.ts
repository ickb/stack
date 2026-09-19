import { describe, expect, it } from "vitest";
import {
  ckbToIckbConversionPlans,
  ickbToCkbConversionPlans,
} from "../../../src/conversion/plans.ts";
import { DAO_OUTPUT_LIMIT } from "../../../src/dao.ts";
import { ICKB_DEPOSIT_CAP } from "../../../src/udt.ts";
import { sittingSeller } from "../../estimate/support/estimate_support.ts";
import {
  conversionContext,
  headerLike,
} from "../../transaction/base/support/sdk_core_support.ts";
import {
  stubSigner,
  testSdk,
} from "../deposits_and_limits/support/sdk_fixture_support.ts";

// Adopted from the sol audit: the planner starts at the consensus limit and completion
// steps the count down; no policy cap sits below the limit.
describe("deposit plan counts", () => {
  it.each([
    { caps: 61n, first: 61 },
    { caps: 100n, first: DAO_OUTPUT_LIMIT - 1 },
  ])("starts the walk at $first deposits for $caps caps", ({ caps, first }) => {
    const amount = ICKB_DEPOSIT_CAP * caps;
    const plans = ckbToIckbConversionPlans({
      direction: "ckb-to-ickb",
      amount,
      lock: testSdk().lock,
      signer: stubSigner,
      context: conversionContext({
        ckbAvailable: amount,
        ickbAvailable: 0n,
      }),
    });

    expect(plans[0]?.depositCount).toBe(first);
    expect(plans.at(-1)?.depositCount).toBe(0);
  });
});

describe("withdrawal plans", () => {
  it("keeps an order leg without a date, on the wallet's own date", () => {
    // A fillable seller left on the book for over a turn: the bot has no CKB to give.
    const [plan] = ickbToCkbConversionPlans(
      {
        direction: "ickb-to-ckb",
        amount: ICKB_DEPOSIT_CAP,
        lock: testSdk().lock,
        signer: stubSigner,
        context: conversionContext({
          system: { orderPool: [sittingSeller(0n)], tip: headerLike(1n) },
          ickbAvailable: ICKB_DEPOSIT_CAP,
          estimatedMaturity: 42n,
        }),
      },
      [],
    );

    expect(plan?.order?.estimate.maturity).toBeUndefined();
    expect(plan?.order?.estimate.notice?.kind).toBe("maturity-unavailable");
    expect(plan?.estimatedMaturity).toBe(42n);
  });
});
