import { Ratio } from "@ickb/order";
import { script } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { errorOf } from "../../../src/client/sdk_error.ts";
import { sdkManagers } from "../../../src/client/sdk_state_store.ts";
import {
  ckbToIckbConversionPlans,
  ickbToCkbConversionPlans,
} from "../../../src/conversion/sdk_conversion_plans.ts";
import { conversionContext } from "../../transaction/base/support/sdk_core_support.ts";
import { projectionReadyDeposit } from "../withdrawal_quotes/support/sdk_cell_support.ts";

describe("sdk conversion planning helpers", () => {
  it("covers conversion planning ordering edges", () => {
    const lock = script("11");
    const zeroCapacityPlans = ckbToIckbConversionPlans({
      direction: "ckb-to-ickb",
      amount: 1n,
      lock,
      context: conversionContext({
        system: {
          exchangeRatio: Ratio.from({ ckbScale: 1n << 80n, udtScale: 1n }),
          ckbAvailable: 1n,
        },
        ckbAvailable: 1n,
      }),
    });
    const anchorDeposit = projectionReadyDeposit(3n, 0n, { ckbValue: 3n, id: "50" });
    const pairDeposit = projectionReadyDeposit(2n, 0n, { ckbValue: 2n, id: "51" });
    const unitA = projectionReadyDeposit(1n, 0n, { ckbValue: 1n, id: "52" });
    const unitB = projectionReadyDeposit(1n, 0n, { ckbValue: 1n, id: "53" });
    const laterDeposit = projectionReadyDeposit(2n, 2n * 60n * 60n * 1000n, {
      ckbValue: 3n,
      id: "54",
    });
    const orderedPlans = ickbToCkbConversionPlans(
      {
        direction: "ickb-to-ckb",
        amount: 2n,
        lock,
        context: conversionContext({ ickbAvailable: 2n }),
      },
      {
        deposits: [anchorDeposit, pairDeposit, unitA, unitB, laterDeposit],
        readyDeposits: [anchorDeposit, pairDeposit, unitA, unitB, laterDeposit],
        id: "pool",
      },
    );
    const immediatelyMaturePlans = orderedPlans.plans.filter(
      (plan) => plan.estimatedMaturity === 0n,
    );
    const twoDepositPlans = orderedPlans.plans.filter(
      (plan) => plan.selectedDeposits.length === 2,
    );

    expect(zeroCapacityPlans).toMatchObject({
      lastFailure: "amount-too-small",
      plans: [],
    });
    expect(immediatelyMaturePlans).toHaveLength(2);
    expect(twoDepositPlans).toHaveLength(1);
  });

  it("derives ready pool deposits from the concrete pool snapshot", () => {
    const lock = script("11");
    const fabricatedReadyDeposit = projectionReadyDeposit(2n, 0n, { id: "55" });

    expect(
      ickbToCkbConversionPlans(
        {
          direction: "ickb-to-ckb",
          amount: 2n,
          lock,
          context: conversionContext({ ickbAvailable: 2n }),
        },
        {
          deposits: [],
          readyDeposits: [fabricatedReadyDeposit],
          id: "pool",
        },
      ),
    ).toMatchObject({ lastFailure: "amount-too-small", plans: [] });
  });

  it("normalizes unknown errors and missing SDK managers", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;

    expect(errorOf("plain").message).toBe("plain");
    expect(errorOf({ message: "from object" }).message).toBe("from object");
    expect(errorOf({ value: 1n }).message).toBe('{"value":"1"}');
    expect(errorOf(circular).message).toBe("[object Object]");
    expect(() => sdkManagers({})).toThrow("SDK managers not initialized");
  });
});
