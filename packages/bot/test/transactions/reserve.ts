import { ccc } from "@ckb-ccc/core";
import { receiptPhase2Capacity } from "@ickb/core";
import { OrderManager } from "@ickb/order";
import { script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CKB_RESERVE } from "../../src/policy.ts";
import { buildTransaction } from "../../src/runtime/transaction.ts";
import {
  botRuntime,
  botState,
  readyDeposit,
  TARGET_ICKB_BALANCE,
  testMatch,
  testWithdrawal,
} from "../bot/fixtures/bot.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildTransaction reserve violation skip", () => {
  it("skips built transactions that would violate the bot available CKB reserve", async () => {
    const lock = script("11");
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      ckbDelta: -1n,
      udtDelta: 0n,
      partials: [testMatch("60")],
    });
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);
    const runtime = botRuntime({
      primaryLock: lock,
      managers: {
        logic: {
          deposit: async (txLike: ccc.TransactionLike): Promise<ccc.Transaction> => {
            await Promise.resolve();
            return ccc.Transaction.from(txLike);
          },
        },
      },
      sdk: {
        completeTransaction: async (
          txLike: ccc.TransactionLike,
        ): Promise<ccc.Transaction> => {
          await Promise.resolve();
          return ccc.Transaction.from(txLike);
        },
      },
    });
    const state = botState({
      marketOrders: [testMatch("61").order],
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
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      ckbDelta: 1n,
      udtDelta: 0n,
      partials: [],
    });
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);
    const runtime = botRuntime({
      primaryLock: lock,
      sdk: {
        completeTransaction: async (
          txLike: ccc.TransactionLike,
        ): Promise<ccc.Transaction> => {
          await Promise.resolve();
          const tx = ccc.Transaction.from(txLike);
          tx.addOutput({ capacity: ccc.fixedPointFrom(500), lock });
          return tx;
        },
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
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      ckbDelta: 0n,
      udtDelta: 0n,
      partials: [],
    });
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);
    const state = botState({
      availableCkbBalance: ccc.fixedPointFrom(2000),
      availableIckbBalance: 0n,
      depositCapacity: 100n,
      totalCkbBalance: ccc.fixedPointFrom(2000),
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
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      ckbDelta: -1n,
      udtDelta: 1n,
      partials: [testMatch("63")],
    });
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);
    const runtime = botRuntime({
      primaryLock: lock,
      sdk: {
        completeTransaction: async (
          txLike: ccc.TransactionLike,
        ): Promise<ccc.Transaction> => {
          await Promise.resolve();
          return ccc.Transaction.from(txLike);
        },
      },
    });
    const state = botState({
      marketOrders: [testMatch("64").order],
      availableCkbBalance: CKB_RESERVE,
      availableIckbBalance: TARGET_ICKB_BALANCE + 9n,
      totalCkbBalance: CKB_RESERVE,
      depositCapacity: ccc.fixedPointFrom(1000),
      readyPoolDeposits: [
        readyDeposit("1b", 4n, 20n * 60n * 1000n),
        readyDeposit("1c", 6n, 25n * 60n * 1000n),
        readyDeposit("1d", 5n, 40n * 60n * 1000n),
      ],
    });

    const result = await buildTransaction(runtime, state);

    expect(result).toMatchObject({
      kind: "skipped",
      reason: "post_tx_ckb_reserve",
      actions: { matchedOrders: 0, withdrawalRequests: 0 },
      decision: {
        skip: {
          reason: "post_tx_ckb_reserve",
          attemptedActions: { matchedOrders: 1, withdrawalRequests: 2 },
        },
      },
    });
    expect(result.decision.audit.reserveCheck.recoveryException).toBe(false);
  });
});

describe("buildTransaction reserve recovery with withdrawals", () => {
  it("allows reserve-recovery withdrawal requests mixed with CKB-replenishing matches", async () => {
    const lock = script("1e");
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      ckbDelta: 1n,
      udtDelta: -1n,
      partials: [testMatch("65")],
    });
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);
    const state = botState({
      marketOrders: [testMatch("66").order],
      availableCkbBalance: CKB_RESERVE - 50n,
      availableIckbBalance: TARGET_ICKB_BALANCE + 9n,
      totalCkbBalance: CKB_RESERVE - 50n,
      depositCapacity: ccc.fixedPointFrom(1000),
      readyPoolDeposits: [
        readyDeposit("20", 4n, 20n * 60n * 1000n),
        readyDeposit("21", 6n, 25n * 60n * 1000n),
        readyDeposit("22", 5n, 40n * 60n * 1000n),
      ],
    });

    const result = await buildTransaction(
      botRuntime({
        primaryLock: lock,
        sdk: {
          completeTransaction: async (
            txLike: ccc.TransactionLike,
          ): Promise<ccc.Transaction> => {
            await Promise.resolve();
            return ccc.Transaction.from(txLike);
          },
        },
      }),
      state,
    );

    expect(result).toMatchObject({
      kind: "built",
      actions: { matchedOrders: 1, withdrawalRequests: 2 },
      decision: { rebalance: { kind: "withdraw", reason: "reserve_recovery" } },
    });
    expect(result.decision.skip).toBeUndefined();
  });
});
