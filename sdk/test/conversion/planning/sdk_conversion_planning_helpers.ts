import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import {
  ckbToIckbConversionPlans,
  ickbToCkbConversionPlans,
} from "../../../src/conversion/plans.ts";
import type { DepositCell } from "../../../src/logic.ts";
import { Ratio } from "../../../src/order/ratio.ts";
import { state } from "../../transaction/base/support/sdk_core_support.ts";
import { stubSigner } from "../deposits_and_limits/support/sdk_fixture_support.ts";
import { projectionReadyDeposit } from "../withdrawal_quotes/support/sdk_cell_support.ts";

describe("sdk conversion planning helpers", () => {
  it("plans greedy prefixes and drops unrepresentable ones", () => {
    const zeroCapacityPlans = ckbToIckbConversionPlans({
      direction: "ckb-to-ickb",
      amount: 1n,
      signer: stubSigner,
      state: state({
        exchangeRatio: Ratio.from({ ckbScale: 1n << 80n, udtScale: 1n }),
      }),
    });
    // Every plan now mints an order, so the amounts are large enough to represent one.
    const unit = ccc.fixedPointFrom(1000);
    const deposit = (units: bigint, id: string, maturity = 0n): DepositCell =>
      projectionReadyDeposit(units * unit, maturity, { ckbValue: units * unit, id });
    const anchorDeposit = deposit(3n, "50");
    const pairDeposit = deposit(2n, "51");
    const unitA = deposit(1n, "52");
    const unitB = deposit(1n, "53");
    const laterDeposit = deposit(2n, "54", 2n * 60n * 60n * 1000n);
    const amount = 2n * unit + unit / 2n;
    const orderedPlans = ickbToCkbConversionPlans({
      direction: "ickb-to-ckb",
      amount,
      signer: stubSigner,
      state: state({
        ickbAvailable: amount,
        poolDeposits: [anchorDeposit, pairDeposit, unitA, unitB, laterDeposit],
      }),
    });

    expect(zeroCapacityPlans).toEqual([]);
    expectOrderedCandidates(orderedPlans, [
      [anchorDeposit, "anchor"],
      [pairDeposit, "pair"],
      [unitA, "unit-a"],
      [unitB, "unit-b"],
      [laterDeposit, "later"],
    ]);
  });

  it("plans every prefix of the greedy selection, longest first", () => {
    const unit = ccc.fixedPointFrom(1000);
    // The largest deposit is the segment anchor; the other four are surplus.
    const anchor = projectionReadyDeposit(5n * unit, 0n, { id: "64" });
    const now = ["60", "61", "62"].map((id) => projectionReadyDeposit(unit, 0n, { id }));
    const later = projectionReadyDeposit(unit, 2n * 60n * 60n * 1000n, { id: "63" });

    const plans = ickbToCkbConversionPlans({
      direction: "ickb-to-ckb",
      amount: 4n * unit,
      signer: stubSigner,
      state: state({
        ickbAvailable: 4n * unit,
        poolDeposits: [anchor, ...now, later],
      }),
    });

    // The most direct plan comes first whatever its date: free and certain beats fast. All
    // four would cover the amount exactly and leave no order, so the walk starts at three.
    expect(plans.map((plan) => plan.selectedDeposits.length)).toEqual([3, 2, 1, 0]);
  });

  it("derives ready pool deposits from the concrete pool sample", () => {
    expect(
      ickbToCkbConversionPlans({
        direction: "ickb-to-ckb",
        amount: 2n,
        signer: stubSigner,
        state: state({ ickbAvailable: 2n }),
      }),
    ).toEqual([]);
  });
});

function expectOrderedCandidates(
  plans: ReturnType<typeof ickbToCkbConversionPlans>,
  names: Array<[DepositCell, string]>,
): void {
  const candidateNames = new Map(names);
  expect(
    plans.map((plan) => ({
      candidates: plan.selectedDeposits.map((deposit) => candidateNames.get(deposit)),
      count: plan.selectedDeposits.length,
    })),
  ).toEqual([
    // Greedy by maturity takes the pair; the units and the later deposit no longer fit.
    // Each plan carries its remainder as an order, the order-only one included.
    { candidates: ["pair"], count: 1 },
    { candidates: [], count: 0 },
  ]);
}
