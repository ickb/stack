import { ccc } from "@ckb-ccc/core";
import { IckbError, OrderManager, receiptPhase2Capacity } from "@ickb/sdk";

import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CKB_RESERVE } from "../../../src/bot/policy/constants.ts";
import { buildTransaction } from "../../../src/bot/runtime/transaction.ts";
import {
  botRuntime,
  botState,
  completeSearchResult,
  readyDeposit,
  searchResult,
  TARGET_ICKB_BALANCE,
  testMatch,
  testWithdrawal,
} from "../fixtures/bot.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildTransaction reserve violation skip", () => {
  it("skips built transactions that would violate the bot available CKB reserve", async () => {
    const lock = script("11");
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      searchResult("complete", [await testMatch("60", { ckbDelta: -1n })]),
    );
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);
    const runtime = botRuntime({ primaryLock: lock });
    const state = botState({
      marketOrders: [(await testMatch("61")).group],
      availableCkbBalance: CKB_RESERVE + 1n,
      availableIckbBalance: TARGET_ICKB_BALANCE,
      totalCkbBalance: CKB_RESERVE + 1n,
    });

    const result = await buildTransaction(runtime, state);

    expect(result).toMatchObject({
      kind: "skipped",
      reason: "post_tx_ckb_reserve",
      decision: {
        balances: { spendableCkb: 1n, matchableCkb: 0n },
        skip: { reason: "post_tx_ckb_reserve" },
        audit: {
          reserveCheck: {
            availableCkb: CKB_RESERVE + 1n,
            matchCkbDelta: -1n,
            estimatedFee: 1n,
            reserve: CKB_RESERVE,
            recoveryException: false,
          },
        },
      },
    });
    expect(result.decision.audit.reserveCheck.deficit).toBe(
      CKB_RESERVE - result.decision.audit.reserveCheck.projectedPostTransactionCkb,
    );
  });
});

describe("buildTransaction CKB reserve recovery", () => {
  it("allows CKB-replenishing transactions even when available CKB remains below reserve", async () => {
    const lock = script("11");
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      completeSearchResult({ ckbDelta: 0n, udtDelta: 0n, partials: [] }),
    );
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);
    const runtime = botRuntime({
      primaryLock: lock,
      completeTransaction: async (
        txLike: ccc.TransactionLike,
      ): Promise<ccc.Transaction> => {
        await Promise.resolve();
        const tx = ccc.Transaction.from(txLike);
        tx.addOutput({ capacity: ccc.fixedPointFrom(500), lock });
        return tx;
      },
    });
    const state = botState({
      readyWithdrawals: [testWithdrawal("62")],
      availableCkbBalance: ccc.fixedPointFrom(2000),
      availableIckbBalance: TARGET_ICKB_BALANCE,
      totalCkbBalance: ccc.fixedPointFrom(2000),
    });

    const result = await buildTransaction(runtime, state);

    expect(result).toMatchObject({ kind: "built", actions: { withdrawals: 1 } });
    expect(result.decision.skip).toBeUndefined();
  });
});

describe("buildTransaction direct deposit audit", () => {
  it("records direct deposit reserve costs", async () => {
    const lock = script("18");
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      completeSearchResult({
        ckbDelta: 0n,
        udtDelta: 0n,
        partials: [],
      }),
    );
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);
    const state = botState({
      availableCkbBalance: ccc.fixedPointFrom(3000),
      availableIckbBalance: 0n,
      depositCapacity: ccc.fixedPointFrom(1100),
      totalCkbBalance: ccc.fixedPointFrom(3000),
    });

    const result = await buildTransaction(botRuntime({ primaryLock: lock }), state);

    expect(result).toMatchObject({
      kind: "built",
      actions: { deposits: 1 },
      decision: {
        rebalance: { kind: "deposit" },
        audit: {
          reserveCheck: {
            directDepositCost: state.depositCapacity + receiptPhase2Capacity(lock),
            withdrawalRequestCost: 0n,
          },
        },
      },
    });
  });
});

describe("buildTransaction reserve violation with withdrawals", () => {
  it("skips withdrawal requests mixed with CKB-spending matches that violate reserve", async () => {
    const lock = script("19");
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      searchResult("complete", [await testMatch("63", { ckbDelta: -1n, udtDelta: 1n })]),
    );
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);
    const runtime = botRuntime({ primaryLock: lock });
    const state = botState({
      marketOrders: [(await testMatch("64")).group],
      availableCkbBalance: CKB_RESERVE,
      availableIckbBalance: TARGET_ICKB_BALANCE + 9n,
      totalCkbBalance: CKB_RESERVE,
      depositCapacity: ccc.fixedPointFrom(1100),
      poolDeposits: [
        readyDeposit("1b", 4n, 20n * 60n * 1000n),
        readyDeposit("1c", 6n, 25n * 60n * 1000n),
        readyDeposit("1d", 5n, 40n * 60n * 1000n),
      ],
    });

    const result = await buildTransaction(runtime, state);

    // Every withdrawal prefix fails the reserve predicate, so the match alone is tried and
    // skipped by the post-completion guard.
    expect(result).toMatchObject({
      kind: "skipped",
      reason: "post_tx_ckb_reserve",
      actions: { matchedOrders: 0, withdrawalRequests: 0 },
      decision: {
        rebalance: {
          kind: "none",
          reason: "no_fundable_withdrawal_prefix",
          withdrawalCandidateCount: 2,
        },
        skip: {
          reason: "post_tx_ckb_reserve",
          attemptedActions: { matchedOrders: 1, withdrawalRequests: 0 },
        },
      },
    });
    expect(result.decision.audit.reserveCheck.recoveryException).toBe(false);
  });
});

describe("buildTransaction reserve recovery with withdrawals", () => {
  it("allows reserve-recovery withdrawal requests mixed with CKB-replenishing matches", async () => {
    const lock = script("1e");
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      searchResult("complete", [await testMatch("65", { ckbDelta: 1n, udtDelta: -1n })]),
    );
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);
    const state = botState({
      marketOrders: [(await testMatch("66")).group],
      availableCkbBalance: CKB_RESERVE - 50n,
      availableIckbBalance: TARGET_ICKB_BALANCE + 9n,
      totalCkbBalance: CKB_RESERVE - 50n,
      depositCapacity: ccc.fixedPointFrom(1100),
      poolDeposits: [
        readyDeposit("20", 4n, 20n * 60n * 1000n),
        readyDeposit("21", 6n, 25n * 60n * 1000n),
        readyDeposit("22", 5n, 40n * 60n * 1000n),
      ],
    });

    const result = await buildTransaction(botRuntime({ primaryLock: lock }), state);

    expect(result).toMatchObject({
      kind: "built",
      actions: { matchedOrders: 1, withdrawalRequests: 2 },
      decision: { rebalance: { kind: "withdraw", reason: "reserve_recovery" } },
    });
    expect(result.decision.skip).toBeUndefined();
  });
});

describe("buildTransaction reserve recovery fallback", () => {
  it("withdraws any ready deposit when no ring-surplus prefix can be funded", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      searchResult("complete", [await testMatch("67", { ckbDelta: 1n, udtDelta: -1n })]),
    );
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);
    const anchor = readyDeposit("21", 6n, 25n * 60n * 1000n);
    const state = botState({
      marketOrders: [(await testMatch("68")).group],
      availableCkbBalance: CKB_RESERVE - 50n,
      availableIckbBalance: TARGET_ICKB_BALANCE + 9n,
      totalCkbBalance: CKB_RESERVE - 50n,
      depositCapacity: ccc.fixedPointFrom(1100),
      poolDeposits: [
        readyDeposit("20", 4n, 20n * 60n * 1000n),
        anchor,
        readyDeposit("22", 5n, 40n * 60n * 1000n),
      ],
    });
    // Each attempt is keyed by whether the built transaction spends the anchor; only one that
    // does can be funded, so every surplus prefix fails.
    const attempts: boolean[] = [];
    const completeTransaction = vi.fn(async (txLike: ccc.TransactionLike) => {
      await Promise.resolve();
      const tx = ccc.Transaction.from(txLike);
      const spendsAnchor = tx.inputs.some((input) =>
        input.previousOutput.eq(anchor.cell.outPoint),
      );
      attempts.push(spendsAnchor);
      if (!spendsAnchor) {
        throw new IckbError("short", { code: "insufficient_capacity" });
      }
      return tx;
    });

    const result = await buildTransaction(
      botRuntime({ primaryLock: script("1f"), completeTransaction }),
      state,
    );

    expect(result).toMatchObject({
      kind: "built",
      actions: { withdrawalRequests: 3 },
      decision: {
        rebalance: {
          kind: "withdraw",
          reason: "reserve_recovery",
          withdrawalRequestCount: 3,
          withdrawalCandidateCount: 3,
        },
      },
    });
    // Surplus prefixes [20, 22] and [20], then the any-deposit prefix [20, 21, 22].
    expect(attempts).toEqual([false, false, true]);
  });
});
