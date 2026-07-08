import { describe, expect, it } from "vitest";
import { usefulMatchFloors } from "../../src/runtime/support.ts";

describe("usefulMatchFloors", () => {
  it("uses allowance steps when matchable directions have no lower bound", () => {
    expect(
      usefulMatchFloors({
        orderCount: 1,
        allowance: { ckbValue: 0n, udtValue: 0n },
        ckbAllowanceStep: 3n,
        udtAllowanceStep: 5n,
        ckbMiningFee: 1n,
        directions: {
          ckbToUdt: { matchableCount: 1 },
          udtToCkb: { matchableCount: 1 },
        },
        candidates: {
          total: 1,
          viable: 0,
          positiveGain: 0,
          rejected: {
            maxPartials: 0,
            duplicateOrder: 0,
            insufficientCkbAllowance: 0,
            insufficientUdtAllowance: 0,
            nonPositiveGain: 0,
          },
          bestGain: 0n,
        },
      }),
    ).toEqual({ ckb: 3n, ickb: 5n });
  });
});
