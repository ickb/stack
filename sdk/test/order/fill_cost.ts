import { ccc } from "@ckb-ccc/core";
import { byte32FromByte } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import type { OrderGroup } from "../../src/order/cells.ts";
import { fillsWhole } from "../../src/order/fill.ts";
import { Info } from "../../src/order/info.ts";
import { resolvedOrderGroup } from "./matching/support/order_match_helpers.ts";
import { makeOrderCell } from "./matching/support/order_order_helpers.ts";

describe("fillsWhole", () => {
  it("takes a buy once its fill returns more than ten fees of a partial its own size", () => {
    // The buy gives its CKB for half as much UDT, rounded up. At one shannon per byte a
    // partial of this order costs 283 shannons, so its fill must gain over 2,830: 4,000
    // shannons gain 2,000, 8,000 gain 4,000, 5,660 gain exactly 2,830 and 5,662 gain 2,831.
    // The exchange ratio counts each unit of either side three times.
    const buy = (ckbUnoccupied: bigint): OrderGroup =>
      resolvedOrderGroup(
        makeOrderCell({
          ckbUnoccupied,
          udtValue: 0n,
          info: Info.create(true, { ckbScale: 1n, udtScale: 2n }),
          master: {
            type: "absolute",
            value: { txHash: byte32FromByte("66"), index: 1n },
          },
          outPoint: { txHash: byte32FromByte("55"), index: 0n },
        }),
      );
    const exchangeRatio = { ckbScale: 3n, udtScale: 3n };
    const feeRate = ccc.numFrom(1000);

    expect(fillsWhole(buy(4000n), true, exchangeRatio, feeRate)).toBe(false);
    expect(fillsWhole(buy(8000n), true, exchangeRatio, feeRate)).toBe(true);
    // At the line, so a multiple of nine or eleven fees fails one of the two.
    expect(fillsWhole(buy(5660n), true, exchangeRatio, feeRate)).toBe(false);
    expect(fillsWhole(buy(5662n), true, exchangeRatio, feeRate)).toBe(true);
  });
});
