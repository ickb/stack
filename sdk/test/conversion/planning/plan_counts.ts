import { describe, expect, it } from "vitest";
import { ckbToIckbConversionPlans } from "../../../src/conversion/sdk_conversion_plans.ts";
import { ICKB_DEPOSIT_CAP } from "../../../src/core/index.ts";
import { DAO_OUTPUT_LIMIT } from "../../../src/dao/index.ts";
import { conversionContext } from "../../transaction/base/support/sdk_core_support.ts";
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
        system: { ckbAvailable: amount },
        ckbAvailable: amount,
        ickbAvailable: 0n,
      }),
    });

    expect(plans[0]?.depositCount).toBe(first);
    expect(plans.at(-1)?.depositCount).toBe(0);
  });
});
