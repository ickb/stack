import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import {
  CKB_RESERVE,
  readStimulusState,
  STALE_ORDER_BLOCKS,
} from "../../src/stimulus/state.ts";
import {
  accountState,
  CKB,
  order,
  plainCell,
  runtime,
  systemState,
} from "./support/fixtures.ts";

describe("readStimulusState", () => {
  it("collects fulfilled and stale orders, keeps fresh ones live, and counts them all as capital", async () => {
    const system = systemState();
    const fulfilled = await order("a1", false);
    const fresh = await order("a2", true);
    const stale = await order("a3", true);
    const uncommitted = await order("a4", true);
    const tipNumber = system.tip.number;

    const state = await readStimulusState(
      runtime({
        system,
        account: accountState({ capacityCells: [plainCell(1500n * CKB, "b1")] }),
        orders: [fulfilled, fresh, stale, uncommitted],
        originBlocks: new Map<ccc.Hex, bigint | undefined>([
          [fresh.origin.cell.outPoint.txHash, tipNumber - STALE_ORDER_BLOCKS + 1n],
          [stale.origin.cell.outPoint.txHash, tipNumber - STALE_ORDER_BLOCKS],
          [uncommitted.origin.cell.outPoint.txHash, undefined],
        ]),
      }),
    );

    expect(state.collectable).toEqual([fulfilled, stale]);
    expect(state.orders).toEqual({ live: 3, fulfilled: 1, stale: 1 });
    expect(state.context.availableOrders).toEqual([fulfilled, stale]);
    expect(state.plainCkb).toBe(1500n * CKB);
    // Plain CKB plus the two collectable groups' cells, minus the reserve; live groups
    // count only toward the total.
    expect(state.budgets.ckb).toBe(
      1500n * CKB + fulfilled.ckbValue + stale.ckbValue - CKB_RESERVE,
    );
    expect(state.totalCkb).toBe(
      1500n * CKB +
        fulfilled.ckbValue +
        fresh.ckbValue +
        stale.ckbValue +
        uncommitted.ckbValue,
    );
    expect(state.totalEquivalentCkb).toBe(state.totalCkb);
  });

  it("clamps the CKB budget at zero and derives the capital minimum from the deposit cap", async () => {
    const state = await readStimulusState(
      runtime({
        account: accountState({ capacityCells: [plainCell(100n * CKB, "b1")] }),
      }),
    );

    expect(state.budgets).toMatchObject({ ckb: 0n, ickb: 0n });
    expect(state.capitalMinimum).toBe(ccc.fixedPointFrom(100_000) / 20n);
    expect(state.totalEquivalentCkb).toBe(100n * CKB);
  });
});
