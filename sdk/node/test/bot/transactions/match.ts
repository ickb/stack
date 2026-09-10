import { ccc } from "@ckb-ccc/core";
import { OrderManager } from "../../../../src/order/index.ts";
import { partialOrderFee } from "../../../../src/order/io/order_io.ts";

import { afterEach, describe, expect, it, vi } from "vitest";
import { CKB_RESERVE } from "../../../src/bot/policy/constants.ts";
import { buildTransaction } from "../../../src/bot/runtime/transaction.ts";
import {
  BAND_ICKB_BALANCE,
  botRuntime,
  botState,
  marketOrder,
  testWithdrawal,
} from "../fixtures/bot.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const RESERVE_CHANGE = ccc.fixedPointFrom(1500);

/** A completion that returns the reserve as plain change to the bot. */
function completing(change = RESERVE_CHANGE): Parameters<typeof botRuntime>[0] {
  return {
    completeTransaction: async (txLike): Promise<ccc.Transaction> => {
      await Promise.resolve();
      const tx = ccc.Transaction.from(txLike).clone();
      tx.addOutput({ capacity: change, lock: botRuntime().primaryLock }, "0x");
      return tx;
    },
  };
}

describe("buildTransaction matching", () => {
  it("offers the CKB above the reserve, less the fill's fee, to a seller", async () => {
    // The seller hands over twice its CKB ask in iCKB, whole only.
    const ask = ccc.fixedPointFrom(4000);
    const seller = marketOrder({
      byte: "30",
      ckb: 0n,
      udt: 2n * ask,
      ratio: { ckbScale: 2n, udtScale: 1n },
      ckbMinMatchLog: 44,
    });
    const fee = partialOrderFee([seller], 1n);
    const state = (ckb: bigint): ReturnType<typeof botState> =>
      botState({ marketOrders: [seller], ckb, ickb: BAND_ICKB_BALANCE });

    const short = await buildTransaction(
      botRuntime(completing()),
      state(CKB_RESERVE + ask + fee - 1n),
    );
    const enough = await buildTransaction(
      botRuntime(completing()),
      state(CKB_RESERVE + ask + fee),
    );

    expect(short.decision.match).toMatchObject({ reason: "no_match", candidates: 1 });
    expect(enough.decision.match).toMatchObject({ reason: "matched", partialCount: 1 });
  });

  it("skips with no_actions when the book, the collections, and the rebalance are all empty", async () => {
    const result = await buildTransaction(
      botRuntime(),
      botState({ ckb: ccc.fixedPointFrom(5000), ickb: BAND_ICKB_BALANCE }),
    );

    expect(result).toMatchObject({
      kind: "skipped",
      reason: "no_actions",
      decision: {
        match: { reason: "no_market_orders", candidates: 0 },
        core: { kind: "none", attempts: 0 },
      },
    });
  });

  it("reports no_match when the balances pay no fill", async () => {
    const buyer = marketOrder({
      byte: "31",
      ckb: ccc.fixedPointFrom(200),
      udt: 0n,
      ratio: { ckbScale: 1n, udtScale: 2n },
    });

    const result = await buildTransaction(
      botRuntime(),
      botState({ marketOrders: [buyer], ckb: CKB_RESERVE, ickb: 0n }),
    );

    expect(result).toMatchObject({
      kind: "skipped",
      reason: "no_actions",
      decision: { match: { reason: "no_match", partialCount: 0, candidates: 1 } },
    });
  });

  it("propagates unexpected match failures", async () => {
    vi.spyOn(OrderManager.prototype, "addMatch").mockImplementation(() => {
      throw new Error("match failed");
    });

    await expect(buildTransaction(botRuntime(), botState({}))).rejects.toThrow(
      "match failed",
    );
  });

  it("builds a gaining match with its evidence", async () => {
    // The buyer pays two CKB per iCKB against a one-to-one rate.
    const buyer = marketOrder({
      byte: "32",
      ckb: ccc.fixedPointFrom(200),
      udt: 0n,
      ratio: { ckbScale: 1n, udtScale: 2n },
    });
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1000n);

    const result = await buildTransaction(
      botRuntime(completing()),
      botState({
        marketOrders: [buyer],
        ckb: ccc.fixedPointFrom(5000),
        ickb: BAND_ICKB_BALANCE,
      }),
    );

    expect(result).toMatchObject({
      kind: "built",
      actions: { matchedOrders: 1, deposits: 0, withdrawalRequests: 0 },
      decision: {
        match: {
          reason: "matched",
          partialCount: 1,
          ckbDelta: ccc.fixedPointFrom(200),
          udtDelta: -ccc.fixedPointFrom(100),
          matchedOrderOutPoints: [{ index: "0" }],
          candidates: 1,
          fee: partialOrderFee([buyer], 1n),
        },
        core: { kind: "none", attempts: 1 },
        fee: { estimated: 1000n },
      },
    });
    expect(typeof result.decision.match.seed).toBe("number");
  });

  it("sends collections alone and counts them", async () => {
    const runtime = botRuntime(completing());
    const withdraw = vi.spyOn(runtime.managers.ownedOwner, "withdraw");

    const result = await buildTransaction(
      runtime,
      botState({
        ckb: ccc.fixedPointFrom(5000),
        ickb: BAND_ICKB_BALANCE,
        readyWithdrawals: [testWithdrawal("33")],
      }),
    );

    expect(withdraw).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      kind: "built",
      actions: { matchedOrders: 0, withdrawals: 1 },
      decision: { core: { kind: "none" } },
    });
  });
});
