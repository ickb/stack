import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { Ratio } from "../../../src/order/ratio.ts";
import { type Budgets, drawTurn } from "../../src/stimulus/draw.ts";

const CKB = ccc.fixedPointFrom(1);
const budgets: Budgets = {
  ckb: 10_000n * CKB,
  ickb: 10_000n * CKB,
  ratio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
};

/** Feeds the listed values in order, then repeats the last one. */
function sequence(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)] ?? 0;
    index += 1;
    return value;
  };
}

describe("drawTurn", () => {
  it("draws nothing when neither side has budget", () => {
    expect(
      drawTurn({ ...budgets, ckb: 0n, ickb: 0n }, {}, sequence([0])),
    ).toBeUndefined();
    expect(
      drawTurn({ ...budgets, ckb: 0n }, { direction: "ckb-to-ickb" }, sequence([0])),
    ).toBeUndefined();
    // A pinned amount needs a direction, drawn or pinned, to spend from.
    expect(
      drawTurn({ ...budgets, ckb: 0n, ickb: 0n }, { amount: CKB }, sequence([0])),
    ).toBeUndefined();
  });

  it("weights the direction by the CKB value of each side and the kind three to one", () => {
    // Direction: 0.3 of the total lands on the CKB side; then the amount bucket, the kind,
    // and the fee, each drawn from the rest of its choices before the first takes the remainder.
    // Each choice owns the half-open interval from its start: 0.25 starts the order's.
    expect(drawTurn(budgets, {}, sequence([0.3, 0.9, 0.25, 0.5]))).toEqual({
      kind: "order",
      direction: "ckb-to-ickb",
      amount: 1n,
      fee: 10n,
    });
    expect(drawTurn(budgets, {}, sequence([0.9, 0.1, 0.2]))).toEqual({
      kind: "conversion",
      direction: "ickb-to-ckb",
      amount: budgets.ickb,
    });
    // A side with nothing to spend is never drawn, even at the bottom of the range.
    expect(drawTurn({ ...budgets, ckb: 0n }, {}, sequence([0]))).toMatchObject({
      direction: "ickb-to-ckb",
    });
    // A sell draws the generous fee from the top of its middle choice's interval.
    expect(
      drawTurn(
        budgets,
        { kind: "order", direction: "ickb-to-ckb", amount: 1n },
        sequence([0.6]),
      ),
    ).toMatchObject({ fee: 100n });
  });

  it("spreads interior amounts across the decades between one CKB and the budget", () => {
    const amounts = [0, 0.5, 0.999].map((point) =>
      drawTurn(budgets, { kind: "order", fee: 0n }, sequence([0, 0.5, point, point])),
    );

    expect(amounts.map((draw) => draw?.amount)).toEqual([
      CKB,
      3n * 2n ** 32n,
      budgets.ckb,
    ]);
  });

  it("uses the pinned amount verbatim, max for the budget, and the pinned fee", () => {
    const conversion = { kind: "conversion", direction: "ckb-to-ickb" } as const;
    expect(
      drawTurn(budgets, { kind: "order", amount: 5n * CKB, fee: 10n }, sequence([0])),
    ).toEqual({ kind: "order", direction: "ckb-to-ickb", amount: 5n * CKB, fee: 10n });
    expect(
      drawTurn({ ...budgets, ckb: 0n }, { ...conversion, amount: "max" }, sequence([0])),
    ).toEqual({ kind: "conversion", direction: "ckb-to-ickb", amount: 0n });
    expect(
      drawTurn(budgets, { ...conversion, amount: "max" }, sequence([0.5])),
    ).toMatchObject({ amount: budgets.ckb });
    // Up to one CKB the budget is the amount, whatever the bucket would have drawn.
    expect(drawTurn({ ...budgets, ckb: CKB }, conversion, sequence([0.9]))).toMatchObject(
      { amount: CKB },
    );
  });

  it("falls back to the first weighted choice when the point exhausts the rest", () => {
    expect(
      drawTurn(budgets, { direction: "ickb-to-ckb", amount: 1n }, sequence([1])),
    ).toMatchObject({ kind: "order", fee: 0n });
    // A buy never draws the zero fee: its first choice is the interface default.
    expect(
      drawTurn(budgets, { direction: "ckb-to-ickb", amount: 1n }, sequence([1])),
    ).toMatchObject({ kind: "order", fee: 10n });
  });
});
