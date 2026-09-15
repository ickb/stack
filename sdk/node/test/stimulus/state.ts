import type { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { CKB_RESERVE } from "../../../src/constants.ts";
import { readStimulusState, STALE_ORDER_BLOCKS } from "../../src/stimulus/state.ts";
import {
  accountState,
  CKB,
  order,
  plainCell,
  runtime,
  systemState,
} from "./support/fixtures.ts";

describe("readStimulusState", () => {
  it("collects fulfilled and stale orders and keeps fresh ones live", async () => {
    const system = systemState();
    const fulfilled = await order("a1", false);
    const fresh = await order("a2", true);
    const stale = await order("a3", true);
    const uncommitted = await order("a4", true);
    // A buy at par: the bot's matcher gains nothing on it and the ratio only grows past it.
    const refused = await order("a5", true, system.exchangeRatio);
    const tipNumber = system.tip.number;

    const state = await readStimulusState(
      runtime({
        system,
        account: accountState({ capacityCells: [plainCell(1500n * CKB, "b1")] }),
        orders: [fulfilled, fresh, stale, uncommitted, refused],
        originBlocks: new Map<ccc.Hex, bigint | undefined>([
          [fresh.origin.cell.outPoint.txHash, tipNumber - STALE_ORDER_BLOCKS + 1n],
          [stale.origin.cell.outPoint.txHash, tipNumber - STALE_ORDER_BLOCKS],
          [uncommitted.origin.cell.outPoint.txHash, undefined],
        ]),
      }),
    );

    expect(state.collectable).toEqual([fulfilled, refused, stale]);
    expect(state.orders).toEqual({ live: 4, fulfilled: 1, refused: 1, stale: 1 });
    expect(state.plainCkb).toBe(1500n * CKB);
    // Plain CKB plus the two collectable groups' cells, minus the reserve; live groups
    // count only toward the total.
    expect(state.budgets.ckb).toBe(
      1500n * CKB + fulfilled.ckbValue + stale.ckbValue + refused.ckbValue - CKB_RESERVE,
    );
    expect(state.context.availableOrders).toEqual([fulfilled, refused, stale]);
  });

  it("clamps the CKB budget at zero", async () => {
    const state = await readStimulusState(
      runtime({
        account: accountState({ capacityCells: [plainCell(100n * CKB, "b1")] }),
      }),
    );

    expect(state.budgets).toMatchObject({ ckb: 0n, ickb: 0n });
  });
});
