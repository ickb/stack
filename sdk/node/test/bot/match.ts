import { ccc } from "@ckb-ccc/core";
import { partialOrderFee } from "../../../src/order/io/order_io.ts";

import { describe, expect, it } from "vitest";
import { matchTurn, seedOf, type TurnMatch } from "../../src/bot/match.ts";
import { FILL_COST_FEES } from "../../src/bot/policy/constants.ts";
import { hash, marketOrder } from "./fixtures/bot.ts";

const CKB = ccc.fixedPointFrom(1);
const UNIT = { ckbScale: 1n, udtScale: 1n };
const FEE_RATE = 1000n;

/** A buyer offering `ckb` for `udt`, or a seller offering `udt` for `ckb`. */
function buyer(
  byte: string,
  ckb: bigint,
  udt: bigint,
  ckbMinMatchLog = 0,
): ReturnType<typeof marketOrder> {
  return marketOrder({ byte, ckb, udt: 0n, ratio: ratioOf(ckb, udt), ckbMinMatchLog });
}

function seller(
  byte: string,
  udt: bigint,
  ckb: bigint,
  ckbMinMatchLog = 0,
): ReturnType<typeof marketOrder> {
  return marketOrder({ byte, ckb: 0n, udt, ratio: ratioOf(ckb, udt), ckbMinMatchLog });
}

function ratioOf(ckb: bigint, udt: bigint): { ckbScale: bigint; udtScale: bigint } {
  const divisor = ccc.gcd(ckb, udt);
  return { ckbScale: udt / divisor, udtScale: ckb / divisor };
}

function turn(
  orders: Array<ReturnType<typeof marketOrder>>,
  balances: { ckb: bigint; udt: bigint },
  options: { seed?: number; maxPartials?: number; exchangeRatio?: typeof UNIT } = {},
): TurnMatch {
  return matchTurn({
    orders,
    ...balances,
    exchangeRatio: options.exchangeRatio ?? UNIT,
    feeRate: FEE_RATE,
    seed: options.seed ?? 1,
    ...(options.maxPartials === undefined ? {} : { maxPartials: options.maxPartials }),
  });
}

function outPoints(match: TurnMatch): string[] {
  return match.partials.map((partial) => partial.group.order.cell.outPoint.txHash);
}

describe("matchTurn", () => {
  it("sizes the one gaining fill to the balances", () => {
    const orders = [buyer("01", 200n * CKB, 100n * CKB)];

    const match = turn(orders, { ckb: CKB, udt: 40n * CKB });

    expect(match).toMatchObject({
      ckbDelta: 80n * CKB,
      udtDelta: -40n * CKB,
      candidates: 1,
      seed: 1,
    });
    expect(match.partials).toHaveLength(1);
  });

  it("takes nothing from empty balances or an empty book", () => {
    expect(
      turn([buyer("02", 200n * CKB, 100n * CKB)], { ckb: 0n, udt: 0n }).partials,
    ).toEqual([]);
    expect(turn([], { ckb: CKB, udt: CKB })).toMatchObject({
      candidates: 0,
      partials: [],
    });
  });

  it("takes a fill only when it returns its cost in fees", () => {
    const fee = partialOrderFee([buyer("03", 2000n, 2000n)], FEE_RATE);
    const cost = FILL_COST_FEES * fee;
    const at = (premium: bigint): TurnMatch =>
      turn([buyer("03", 2000n + premium, 2000n)], { ckb: fee, udt: 2000n });

    expect(at(cost).partials).toEqual([]);
    expect(at(cost + 1n).partials).toHaveLength(1);
  });

  it("chains fills through the inventory each one leaves", () => {
    // With CKB only, the seller comes first; its iCKB then pays the buyer.
    const orders = [
      buyer("04", 2000n * CKB, 1000n * CKB),
      seller("05", 1000n * CKB, 500n * CKB),
    ];

    const match = turn(orders, { ckb: 1000n * CKB, udt: 0n });

    expect(outPoints(match)).toEqual([hash("05"), hash("04")]);
    expect(match).toMatchObject({ ckbDelta: 1500n * CKB, udtDelta: 0n });
  });

  it("reserves the fee before sizing a fill paid in CKB", () => {
    const ask = 100n * CKB;
    const orders = [seller("06", 2n * ask, ask, 44)];
    const fee = partialOrderFee(orders, FEE_RATE);

    expect(turn(orders, { ckb: ask + fee - 1n, udt: 0n }).partials).toEqual([]);
    expect(turn(orders, { ckb: ask + fee, udt: 0n }).partials).toHaveLength(1);
  });

  it("lets a whole order beyond the balances wait", () => {
    const orders = [buyer("07", 200n * CKB, 100n * CKB, 44)];

    expect(turn(orders, { ckb: CKB, udt: 100n * CKB - 1n }).partials).toEqual([]);
    expect(turn(orders, { ckb: CKB, udt: 100n * CKB }).partials).toHaveLength(1);
  });

  it("prefers the larger of two fills at one price", () => {
    const orders = [
      buyer("08", 200n * CKB, 100n * CKB),
      buyer("09", 400n * CKB, 200n * CKB),
    ];

    const match = turn(orders, { ckb: CKB, udt: 1000n * CKB }, { maxPartials: 1 });

    expect(outPoints(match)).toEqual([hash("09")]);
  });

  it("breaks ties by the seed, the same way for the same seed", () => {
    const orders = [
      buyer("0a", 200n * CKB, 100n * CKB),
      buyer("0b", 200n * CKB, 100n * CKB),
    ];
    const picks = new Set<string>();
    for (let seed = 0; seed < 16; seed += 1) {
      const first = turn(
        orders,
        { ckb: CKB, udt: 1000n * CKB },
        { seed, maxPartials: 1 },
      );
      expect(
        outPoints(turn(orders, { ckb: CKB, udt: 1000n * CKB }, { seed, maxPartials: 1 })),
      ).toEqual(outPoints(first));
      picks.add(outPoints(first)[0] ?? "");
    }

    expect(picks).toEqual(new Set([hash("0a"), hash("0b")]));
  });

  it("fills one direction of a dual order, never both", () => {
    // The order buys iCKB at half a CKB and sells it at two; at four CKB per iCKB only
    // buying from it gains.
    const dual = marketOrder({
      byte: "0c",
      ckb: 1000n * CKB,
      udt: 1000n * CKB,
      ratio: { ckbScale: 1n, udtScale: 2n },
    });

    const match = turn(
      [dual],
      { ckb: 1000n * CKB, udt: 1000n * CKB },
      { exchangeRatio: { ckbScale: 1n, udtScale: 4n } },
    );

    expect(match.candidates).toBe(2);
    expect(match.partials).toHaveLength(1);
    expect(match.udtDelta).toBeGreaterThan(0n);
  });

  it("stops at the partial cap", () => {
    const orders = Array.from({ length: 60 }, (_, index) =>
      buyer((0x10 + index).toString(16), 200n * CKB, 100n * CKB),
    );

    expect(turn(orders, { ckb: CKB, udt: 100_000n * CKB }).partials).toHaveLength(58);
  });

  it("matches a thousand-order book within a few hundred milliseconds", () => {
    const orders = Array.from({ length: 1000 }, (_, index) =>
      marketOrder({
        byte: (index % 256).toString(16).padStart(2, "0"),
        ckb: index < 500 ? 2n * CKB : 0n,
        udt: index < 500 ? 0n : 2n * CKB,
        ratio:
          index < 500 ? { ckbScale: 1n, udtScale: 2n } : { ckbScale: 2n, udtScale: 1n },
      }),
    );
    const started = performance.now();

    const match = turn(orders, { ckb: 100n * CKB, udt: 100n * CKB });

    expect(performance.now() - started).toBeLessThan(500);
    expect(match.partials).toHaveLength(58);
  });

  it("seeds from the low bits of the tip hash", () => {
    expect(seedOf(hash("ff"))).toBe(0xff_ff_ff_ff);
    expect(seedOf(hash("00"))).toBe(0);
  });
});
