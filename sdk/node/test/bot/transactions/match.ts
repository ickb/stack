import { ccc } from "@ckb-ccc/core";
import { OrderManager } from "../../../../src/order/index.ts";

import { afterEach, describe, expect, it, vi } from "vitest";
import { CKB_RESERVE } from "../../../src/bot/policy/constants.ts";
import { buildTransaction } from "../../../src/bot/runtime/transaction.ts";
import {
  BAND_ICKB_BALANCE,
  botRuntime,
  botState,
  completeSearchResult,
  incompleteSearchResult,
  searchResult,
  testMatch,
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
  it("offers the CKB above the reserve and all the iCKB as match allowance", async () => {
    const bestMatch = vi
      .spyOn(OrderManager, "bestMatch")
      .mockReturnValue(
        completeSearchResult({ ckbDelta: 0n, udtDelta: 0n, partials: [] }),
      );

    await buildTransaction(
      botRuntime(),
      botState({ ckb: ccc.fixedPointFrom(5000), ickb: BAND_ICKB_BALANCE }),
    );

    expect(bestMatch.mock.calls[0]?.[1]).toEqual({
      ckbValue: ccc.fixedPointFrom(4000),
      udtValue: BAND_ICKB_BALANCE,
    });
  });

  it("skips an empty incomplete search with its evidence when nothing else is due", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      incompleteSearchResult({ ckbDelta: 0n, udtDelta: 0n, partials: [] }),
    );

    const result = await buildTransaction(
      botRuntime(),
      botState({ ckb: ccc.fixedPointFrom(5000), ickb: BAND_ICKB_BALANCE }),
    );

    expect(result).toMatchObject({
      kind: "skipped",
      reason: "match_search_incomplete",
      decision: {
        match: { reason: "search_incomplete" },
        skip: { reason: "match_search_incomplete" },
      },
    });
  });

  it("skips with no_actions when the book, the collections, and the rebalance are all empty", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      completeSearchResult({ ckbDelta: 0n, udtDelta: 0n, partials: [] }),
    );

    const result = await buildTransaction(
      botRuntime(),
      botState({ ckb: ccc.fixedPointFrom(5000), ickb: BAND_ICKB_BALANCE }),
    );

    expect(result).toMatchObject({
      kind: "skipped",
      reason: "no_actions",
      decision: {
        match: { reason: "no_market_orders" },
        core: { kind: "none", attempts: 0 },
      },
    });
  });

  it("reports no_match with the matcher's diagnostics when the allowance takes no order", async () => {
    const marketOrders = [(await testMatch("33")).group];

    const result = await buildTransaction(
      botRuntime(),
      botState({ marketOrders, ckb: CKB_RESERVE, ickb: 0n }),
    );

    expect(result).toMatchObject({
      kind: "skipped",
      reason: "no_actions",
      decision: {
        match: { reason: "no_match", partialCount: 0, diagnostics: { orderCount: 1 } },
      },
    });
  });

  it("propagates unexpected match search failures", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockImplementation(() => {
      throw new Error("search failed");
    });

    await expect(buildTransaction(botRuntime(), botState({}))).rejects.toThrow(
      "search failed",
    );
  });

  it("skips a pure match whose value does not beat the fee of its own bytes", async () => {
    const partial = await testMatch("31", { ckbDelta: 5n });
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      searchResult("complete", [partial]),
    );
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(5n);

    const result = await buildTransaction(
      botRuntime(completing()),
      botState({ ckb: ccc.fixedPointFrom(5000), ickb: BAND_ICKB_BALANCE }),
    );

    expect(result).toMatchObject({
      kind: "skipped",
      reason: "match_value_not_above_fee",
      decision: { match: { value: 5n }, skip: { fee: 5n, matchValue: 5n } },
    });
  });

  it("builds a profitable match, incomplete searches included, with its evidence", async () => {
    const partial = await testMatch("32", { ckbDelta: ccc.fixedPointFrom(10) });
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      searchResult("incomplete", [partial]),
    );
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1000n);

    const result = await buildTransaction(
      botRuntime(completing()),
      botState({ ckb: ccc.fixedPointFrom(5000), ickb: BAND_ICKB_BALANCE }),
    );

    expect(result).toMatchObject({
      kind: "built",
      actions: { matchedOrders: 1, deposits: 0, withdrawalRequests: 0 },
      decision: {
        match: {
          reason: "matched",
          partialCount: 1,
          value: ccc.fixedPointFrom(10),
          matchedOrderOutPoints: [{ index: "1" }],
        },
        core: { kind: "none", attempts: 1 },
        fee: { estimated: 1000n },
      },
    });
  });

  it("sends collections alone and counts them", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      completeSearchResult({ ckbDelta: 0n, udtDelta: 0n, partials: [] }),
    );
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
