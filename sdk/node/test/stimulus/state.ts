import { describe, expect, it } from "vitest";
import { CKB_RESERVE } from "../../src/shared/reserve.ts";
import { readStimulusState } from "../../src/stimulus/state.ts";
import {
  accountState,
  CKB,
  order,
  plainCell,
  runtime,
  systemState,
} from "./support/fixtures.ts";

describe("readStimulusState", () => {
  it("collects fulfilled and refused orders and keeps fillable ones live, whatever their age", async () => {
    const system = systemState();
    const tipNumber = system.tip.number;
    const fulfilled = await order("a1", false, undefined, tipNumber);
    // Fillable, so kept however long it has sat: there is no age cutoff.
    const old = await order("a3", true, undefined, 1n);
    const uncommitted = await order("a4", true);
    // A buy at par: the bot's matcher gains nothing on it and the ratio only grows past it.
    const refused = await order("a5", true, system.exchangeRatio, tipNumber);

    const state = await readStimulusState(
      runtime({
        system,
        account: accountState({ capacityCells: [plainCell(1500n * CKB, "b1")] }),
        orders: [fulfilled, old, uncommitted, refused],
      }),
    );

    expect(state.orders).toEqual({ live: 3, fulfilled: 1, refused: 1 });
    expect(state.liquidCkb).toBe(1500n * CKB);
    // Plain CKB plus the two collectable groups' cells, minus the reserve; live groups
    // count only toward the total.
    expect(state.budgets.ckb).toBe(
      1500n * CKB + fulfilled.ckbValue + refused.ckbValue - CKB_RESERVE,
    );
    expect(state.context.availableOrders).toEqual([fulfilled, refused]);
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
