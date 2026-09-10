import { ccc } from "@ckb-ccc/core";
import { script } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import {
  ckbToIckbConversionPlans,
  ickbToCkbConversionPlans,
} from "../../../src/conversion/sdk_conversion_plans.ts";
import type { IckbDepositCell } from "../../../src/core/index.ts";
import { Ratio } from "../../../src/order/index.ts";
import { conversionContext } from "../../transaction/base/support/sdk_core_support.ts";
import { stubSigner } from "../deposits_and_limits/support/sdk_fixture_support.ts";
import { projectionReadyDeposit } from "../withdrawal_quotes/support/sdk_cell_support.ts";

describe("sdk conversion planning helpers", () => {
  it("plans greedy prefixes and drops unrepresentable ones", () => {
    const lock = script("11");
    const zeroCapacityPlans = ckbToIckbConversionPlans({
      direction: "ckb-to-ickb",
      amount: 1n,
      lock,
      signer: stubSigner,
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
        signer: stubSigner,
        context: conversionContext({ ickbAvailable: 2n }),
      },
      {
        deposits: [anchorDeposit, pairDeposit, unitA, unitB, laterDeposit],
        id: "pool",
      },
    );

    expect(zeroCapacityPlans).toEqual([]);
    expectOrderedCandidates(orderedPlans, [
      [anchorDeposit, "anchor"],
      [pairDeposit, "pair"],
      [unitA, "unit-a"],
      [unitB, "unit-b"],
      [laterDeposit, "later"],
    ]);
  });

  it("ranks prefixes by maturity bucket first, so a late deposit sorts its prefix last", () => {
    const lock = script("11");
    const unit = ccc.fixedPointFrom(1000);
    // The largest deposit is the segment anchor; the other four are surplus.
    const anchor = projectionReadyDeposit(5n * unit, 0n, { id: "64" });
    const now = ["60", "61", "62"].map((id) => projectionReadyDeposit(unit, 0n, { id }));
    const later = projectionReadyDeposit(unit, 2n * 60n * 60n * 1000n, { id: "63" });

    const plans = ickbToCkbConversionPlans(
      {
        direction: "ickb-to-ckb",
        amount: 4n * unit,
        lock,
        signer: stubSigner,
        context: conversionContext({
          system: { ckbAvailable: ccc.fixedPointFrom(1_000_000) },
          ickbAvailable: 4n * unit,
        }),
      },
      { deposits: [anchor, ...now, later], id: "pool" },
    );

    // Every prefix with a remainder order matures now (bucket 0); the full prefix waits
    // for the late deposit and sorts last despite being the longest.
    expect(plans.map((plan) => plan.selectedDeposits.length)).toEqual([3, 2, 1, 0, 4]);
  });

  it("derives ready pool deposits from the concrete pool sample", () => {
    const lock = script("11");
    expect(
      ickbToCkbConversionPlans(
        {
          direction: "ickb-to-ckb",
          amount: 2n,
          lock,
          signer: stubSigner,
          context: conversionContext({ ickbAvailable: 2n }),
        },
        {
          deposits: [],
          id: "pool",
        },
      ),
    ).toEqual([]);
  });
});

function expectOrderedCandidates(
  plans: ReturnType<typeof ickbToCkbConversionPlans>,
  names: Array<[IckbDepositCell, string]>,
): void {
  const candidateNames = new Map(names);
  expect(
    plans.map((plan) => ({
      candidates: plan.selectedDeposits.map((deposit) => candidateNames.get(deposit)),
      count: plan.selectedDeposits.length,
    })),
  ).toEqual([
    // Greedy by maturity takes the pair; the units and the later deposit no longer fit,
    // and the order-only plan is unrepresentable without bot liquidity.
    { candidates: ["pair"], count: 1 },
  ]);
}
