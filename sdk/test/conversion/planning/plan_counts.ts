import { describe, expect, it } from "vitest";
import { ckbToIckbConversionPlans } from "../../../src/conversion/plans.ts";
import { DAO_OUTPUT_LIMIT } from "../../../src/dao.ts";
import { ICKB_DEPOSIT_CAP } from "../../../src/udt.ts";
import { state } from "../../transaction/base/support/sdk_core_support.ts";

// The planner starts at the most deposits the deployed DAO output limit holds beside the
// receipt, the order, its master and the change, and completion steps the count down; no
// policy cap sits below that.
describe("deposit plan counts", () => {
  it.each([
    // An exact multiple would leave no order, so the walk starts a deposit lower.
    { caps: 60n, first: 59 },
    { caps: 100n, first: DAO_OUTPUT_LIMIT - 4 },
  ])("starts the walk at $first deposits for $caps caps", ({ caps, first }) => {
    const amount = ICKB_DEPOSIT_CAP * caps;
    const plans = ckbToIckbConversionPlans(
      state({
        ckbAvailable: amount,
        ickbAvailable: 0n,
      }),
      amount,
    );

    expect(plans[0]?.depositCount).toBe(first);
    expect(plans.at(-1)?.depositCount).toBe(0);
  });
});
