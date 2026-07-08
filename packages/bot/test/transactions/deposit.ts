import { ccc } from "@ckb-ccc/core";
import { receiptPhase2Capacity } from "@ickb/core";
import { OrderManager } from "@ickb/order";
import { asyncPassthroughTransaction, script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CKB_RESERVE } from "../../src/policy.ts";
import { buildTransaction } from "../../src/runtime/transaction.ts";
import {
  botRuntime,
  botState,
  TARGET_ICKB_BALANCE,
  testMatch,
} from "../bot/fixtures/bot.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildTransaction direct deposit seeding", () => {
  it("labels direct ring seeding decisions", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      ckbDelta: 0n,
      udtDelta: 0n,
      partials: [],
    });
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);

    const lock = script("45");
    const deposit = vi.fn(asyncPassthroughTransaction);
    const runtime = botRuntime({ primaryLock: lock, managers: { logic: { deposit } } });
    const state = botState({
      availableCkbBalance: ccc.fixedPointFrom(3000),
      availableIckbBalance: TARGET_ICKB_BALANCE + CKB_RESERVE,
      depositCapacity: ccc.fixedPointFrom(1000),
      totalCkbBalance: ccc.fixedPointFrom(3000),
    });

    await expect(buildTransaction(runtime, state)).resolves.toMatchObject({
      kind: "built",
      actions: { deposits: 1 },
      decision: {
        audit: {
          reserveCheck: {
            directDepositCost: ccc.fixedPointFrom(1000) + receiptPhase2Capacity(lock),
            estimatedFee: 1n,
          },
          rebalanceCosts: {
            directDepositCapacity: ccc.fixedPointFrom(1000) + receiptPhase2Capacity(lock),
            directDepositFeeHeadroom: ccc.fixedPointFrom(1),
          },
          selectedRing: {
            targetDepositCount: 0,
            canCreateRingInventory: true,
            shouldBootstrapRing: true,
          },
        },
        rebalance: { kind: "deposit", reason: "ring_inventory" },
      },
    });
    expect(deposit).toHaveBeenCalledTimes(1);
  });
});

describe("buildTransaction low iCKB direct deposit refill", () => {
  it("refills iCKB when post-match balance is below the useful UDT floor", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      ckbDelta: 0n,
      udtDelta: 0n,
      partials: [],
      diagnostics: matchDiagnostics({
        ckbValue: ccc.fixedPointFrom(2000),
        udtValue: 99n,
      }),
    });
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);
    const deposit = vi.fn(asyncPassthroughTransaction);

    await expect(
      buildTransaction(
        botRuntime({ managers: { logic: { deposit } } }),
        botState({
          availableCkbBalance: ccc.fixedPointFrom(3000),
          availableIckbBalance: 99n,
          depositCapacity: ccc.fixedPointFrom(1000),
          totalCkbBalance: ccc.fixedPointFrom(3000),
          marketOrders: [testMatch("6c").order],
        }),
      ),
    ).resolves.toMatchObject({
      kind: "built",
      actions: { deposits: 1 },
      decision: { rebalance: { kind: "deposit", reason: "low_ickb_balance" } },
    });
    expect(deposit).toHaveBeenCalledTimes(1);
  });

  it("skips direct iCKB refill when only capacity and reserve are available", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      ckbDelta: 0n,
      udtDelta: 0n,
      partials: [],
      diagnostics: matchDiagnostics({
        ckbValue: ccc.fixedPointFrom(1000),
        udtValue: 99n,
      }),
    });
    const deposit = vi.fn(asyncPassthroughTransaction);
    const completeTransaction = vi.fn();

    await expect(
      buildTransaction(
        botRuntime({ managers: { logic: { deposit } }, sdk: { completeTransaction } }),
        botState({
          availableCkbBalance: ccc.fixedPointFrom(1000) + CKB_RESERVE,
          availableIckbBalance: 99n,
          depositCapacity: ccc.fixedPointFrom(1000),
          totalCkbBalance: ccc.fixedPointFrom(1000) + CKB_RESERVE,
          marketOrders: [testMatch("6d").order],
        }),
      ),
    ).resolves.toMatchObject({
      kind: "skipped",
      reason: "no_actions",
      decision: {
        rebalance: { kind: "none", reason: "low_ickb_ckb_reserve_unavailable" },
      },
    });
    expect(deposit).not.toHaveBeenCalled();
    expect(completeTransaction).not.toHaveBeenCalled();
  });
});

describe("buildTransaction post-match direct deposit refill", () => {
  it("refills iCKB in the same transaction when a match depletes it below the useful UDT floor", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      ckbDelta: 1n,
      udtDelta: -60n,
      partials: [testMatch("6e")],
      diagnostics: matchDiagnostics({
        ckbValue: ccc.fixedPointFrom(2000),
        udtValue: 150n,
        positiveGain: 1,
      }),
    });
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);
    const deposit = vi.fn(asyncPassthroughTransaction);

    await expect(
      buildTransaction(
        botRuntime({ managers: { logic: { deposit } } }),
        botState({
          availableCkbBalance: ccc.fixedPointFrom(3000),
          availableIckbBalance: 150n,
          depositCapacity: ccc.fixedPointFrom(1000),
          totalCkbBalance: ccc.fixedPointFrom(3000),
          marketOrders: [testMatch("6f").order],
        }),
      ),
    ).resolves.toMatchObject({
      kind: "built",
      actions: { matchedOrders: 1, deposits: 1 },
      decision: {
        match: { reason: "matched" },
        rebalance: { kind: "deposit", reason: "low_ickb_balance" },
      },
    });
    expect(deposit).toHaveBeenCalledTimes(1);
  });
});

function matchDiagnostics({
  ckbValue,
  udtValue,
  positiveGain = 0,
}: {
  ckbValue: bigint;
  udtValue: bigint;
  positiveGain?: number;
}): ReturnType<typeof OrderManager.bestMatch>["diagnostics"] {
  return {
    orderCount: 1,
    allowance: { ckbValue, udtValue },
    ckbAllowanceStep: 100n,
    udtAllowanceStep: 100n,
    ckbMiningFee: 1n,
    directions: {
      ckbToUdt: { matchableCount: 1, minAllowance: 100n, maxMatch: 1000n },
      udtToCkb: { matchableCount: 0 },
    },
    candidates: {
      total: 1,
      viable: 1,
      positiveGain,
      rejected: {
        maxPartials: 0,
        duplicateOrder: 0,
        insufficientCkbAllowance: 0,
        insufficientUdtAllowance: positiveGain === 0 ? 1 : 0,
        nonPositiveGain: 0,
      },
      bestGain: BigInt(positiveGain),
    },
  };
}
