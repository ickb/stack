import { describe, expect, it } from "vitest";
import { selectReadyDeposits } from "../../src/withdrawal/withdrawal_best_fit.ts";
import {
  findBestAtOrBelow,
  isBetterSelection,
  pickBetterSelection,
  prepareSelections,
  selectByMasks,
  selectGreedyDeposits,
} from "../../src/withdrawal/withdrawal_best_fit_support.ts";

describe("withdrawal best-fit bounded selection support", () => {
  it("prepares selections by score, total, and mask order", () => {
    const prepared = prepareSelections(
      [
        { mask: 0b11, total: 4n, score: 1n },
        { mask: 0b10, total: 5n, score: 1n },
        { mask: 0b01, total: 5n, score: 1n },
        { mask: 0b11, total: 6n, score: 0n },
        { mask: 0b00, total: 7n, score: 3n },
      ],
      2,
    );

    expect(prepared.map(({ selection }) => selection.mask)).toEqual([
      0b11, 0b01, 0b01, 0b01, 0b00,
    ]);
    expect(findBestAtOrBelow(prepared, 3n)).toBeUndefined();
    expect(findBestAtOrBelow(prepared, 6n)?.mask).toBe(0b01);
  });

  it("compares bounded selections across score, total, and masks", () => {
    expect(
      isBetterSelection(
        { firstMask: 0b10, secondMask: 0b00, total: 1n, score: 2n },
        { firstMask: 0b01, secondMask: 0b00, total: 9n, score: 1n },
        2,
        2,
      ),
    ).toBe(true);
    expect(
      isBetterSelection(
        { firstMask: 0b10, secondMask: 0b00, total: 9n, score: 1n },
        { firstMask: 0b01, secondMask: 0b00, total: 1n, score: 1n },
        2,
        2,
      ),
    ).toBe(true);
    expect(
      isBetterSelection(
        { firstMask: 0b00, secondMask: 0b01, total: 1n, score: 1n },
        { firstMask: 0b00, secondMask: 0b10, total: 1n, score: 1n },
        2,
        2,
      ),
    ).toBe(true);
    expect(
      isBetterSelection(
        { firstMask: 0b00, secondMask: 0b10, total: 1n, score: 1n },
        { firstMask: 0b00, secondMask: 0b01, total: 1n, score: 1n },
        2,
        2,
      ),
    ).toBe(false);
    expect(
      isBetterSelection(
        { firstMask: 0b00, secondMask: 0b00, total: 1n, score: 1n },
        { firstMask: 0b00, secondMask: 0b00, total: 1n, score: 1n },
        2,
        2,
      ),
    ).toBe(false);
  });
});

describe("withdrawal best-fit concrete selection support", () => {
  it("selects and compares concrete deposit choices", () => {
    const a = { id: "a", udtValue: 3n, score: 1n };
    const b = { id: "b", udtValue: 5n, score: 2n };
    const c = { id: "c", udtValue: 5n, score: 2n };
    const deposits = [a, b, c];

    expect(selectByMasks(deposits, 0b101)).toEqual([a, c]);
    expect(pickBetterSelection(deposits, [b], [a], (deposit) => deposit.score)).toEqual([
      b,
    ]);
    expect(pickBetterSelection(deposits, [a], [b], (deposit) => deposit.score)).toEqual([
      b,
    ]);
    expect(pickBetterSelection(deposits, [a], [b])).toEqual([b]);
    expect(pickBetterSelection(deposits, [b], [c])).toEqual([b]);
    expect(pickBetterSelection(deposits, [c], [b])).toEqual([b]);
    expect(selectGreedyDeposits(deposits, 5n, 2, 1, (deposit) => deposit.score)).toEqual([
      b,
    ]);
    expect(selectGreedyDeposits(deposits, 1n, 2, 1)).toEqual([]);
  });
});

describe("ready deposit selection support", () => {
  it("keeps an earlier bounded candidate when a later one scores worse", () => {
    const first = { udtValue: 1n, score: 0n };
    const second = { udtValue: 1n, score: -1n };

    expect(
      selectReadyDeposits([first, second], 2n, {
        maxCount: 2,
        score: (deposit) => deposit.score,
      }),
    ).toEqual([first]);
  });
});
