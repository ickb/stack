import { ccc } from "@ckb-ccc/core";
import { type IckbSdk, OrderManager, Ratio } from "@ickb/sdk";

import { headerLike, script } from "@ickb/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CKB_RESERVE } from "../../../src/bot/policy/constants.ts";
import { buildTransaction } from "../../../src/bot/runtime/transaction.ts";
import {
  botRuntime,
  botState,
  completeSearchResult,
  hash,
  readyDeposit,
  TARGET_ICKB_BALANCE,
} from "../bot/fixtures/bot.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildTransaction withdrawal reserve staging", () => {
  it("allows withdrawal requests from an available CKB reserve deficit", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      completeSearchResult({
        ckbDelta: 0n,
        udtDelta: 0n,
        partials: [],
      }),
    );
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);
    const state = botState({
      availableCkbBalance: 0n,
      availableIckbBalance: TARGET_ICKB_BALANCE + 9n,
      totalCkbBalance: 0n,
      depositCapacity: 1000n,
      poolDeposits: [
        readyDeposit("82", 4n, 20n * 60n * 1000n),
        readyDeposit("83", 6n, 25n * 60n * 1000n),
        readyDeposit("84", 5n, 40n * 60n * 1000n),
      ],
    });

    const result = await buildTransaction(
      botRuntime({ primaryLock: script("11") }),
      state,
    );

    expect(result).toMatchObject({ kind: "built", actions: { withdrawalRequests: 2 } });
    expect(result.decision.skip).toBeUndefined();
  });
});

describe("buildTransaction excess withdrawal reserve crossing", () => {
  it("allows excess withdrawal requests that cross below the available CKB reserve", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      completeSearchResult({
        ckbDelta: 0n,
        udtDelta: 0n,
        partials: [],
      }),
    );
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);
    const withdrawal = readyDeposit("86", ccc.fixedPointFrom(1000), 20n * 60n * 1000n);
    const protectedAnchor = readyDeposit(
      "8a",
      ccc.fixedPointFrom(1001),
      25n * 60n * 1000n,
    );
    const futureFirst = readyDeposit("87", ccc.fixedPointFrom(1000), 9n, {
      isReady: false,
    });
    const futureSecond = readyDeposit("88", ccc.fixedPointFrom(1000), 10n, {
      isReady: false,
    });
    const state = botState({
      availableCkbBalance: CKB_RESERVE + 50n,
      availableIckbBalance: TARGET_ICKB_BALANCE + ccc.fixedPointFrom(1000),
      totalCkbBalance: CKB_RESERVE + 50n,
      depositCapacity: ccc.fixedPointFrom(1000),
      poolDeposits: [withdrawal, protectedAnchor, futureFirst, futureSecond],
      system: systemState("89"),
    });

    const result = await buildTransaction(
      botRuntime({ primaryLock: script("11") }),
      state,
    );

    expect(result).toMatchObject({
      kind: "built",
      actions: { withdrawalRequests: 2 },
      decision: { rebalance: { kind: "withdraw", reason: "excess_ickb_balance" } },
    });
    expect(result.decision.audit.reserveCheck.recoveryException).toBe(true);
    expect(result.decision.skip).toBeUndefined();
  });
});

describe("buildTransaction withdrawal required live deposits", () => {
  it("passes required live deposits to SDK base transaction construction", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      completeSearchResult({
        ckbDelta: 0n,
        udtDelta: 0n,
        partials: [],
      }),
    );
    const first = readyDeposit("11", 4n, 20n * 60n * 1000n);
    const protectedAnchor = readyDeposit("12", 6n, 25n * 60n * 1000n);
    const third = readyDeposit("13", 5n, 40n * 60n * 1000n);
    const calls: string[] = [];
    const buildBaseTransaction = vi.fn<IckbSdk["buildBaseTransaction"]>();
    buildBaseTransaction.mockImplementation((txLike: ccc.TransactionLike) => {
      calls.push("base");
      return ccc.Transaction.from(txLike);
    });
    const completeTransaction = vi.fn(
      async (txLike: ccc.TransactionLike): Promise<ccc.Transaction> => {
        await Promise.resolve();
        calls.push("complete");
        expect(calls).toEqual(["base", "complete"]);
        return ccc.Transaction.from(txLike);
      },
    );

    const result = await buildTransaction(
      botRuntime({
        sdk: { buildBaseTransaction },
        completeTransaction,
        primaryLock: script("44"),
      }),
      botState({
        availableIckbBalance: TARGET_ICKB_BALANCE + 9n,
        depositCapacity: 1000n,
        poolDeposits: [first, protectedAnchor, third],
      }),
    );

    expect(result.kind).toBe("built");
    expect(result.actions.withdrawalRequests).toBe(2);
    expect(buildBaseTransaction.mock.calls[0]?.[1]).toMatchObject({
      withdrawalRequest: {
        deposits: [first, third],
        requiredLiveDeposits: [protectedAnchor],
      },
    });
    expect(completeTransaction).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["base", "complete"]);
  });
});

describe("buildTransaction excess withdrawal ready deposit selection", () => {
  it("labels excess withdrawals and passes only ready deposits", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      completeSearchResult({
        ckbDelta: 0n,
        udtDelta: 0n,
        partials: [],
      }),
    );
    const extra = readyDeposit("14", 4n, 20n * 60n * 1000n);
    const protectedAnchor = readyDeposit("15", 6n, 25n * 60n * 1000n);
    const futureFirst = readyDeposit("16", 100n, 9n, { isReady: false });
    const futureSecond = readyDeposit("17", 100n, 10n, { isReady: false });
    const buildBaseTransaction = vi.fn<IckbSdk["buildBaseTransaction"]>();
    buildBaseTransaction.mockImplementation((txLike: ccc.TransactionLike) =>
      ccc.Transaction.from(txLike),
    );

    const result = await buildTransaction(
      botRuntime({ sdk: { buildBaseTransaction }, primaryLock: script("46") }),
      botState({
        availableCkbBalance: ccc.fixedPointFrom(1999),
        availableIckbBalance: TARGET_ICKB_BALANCE + 9n,
        depositCapacity: ccc.fixedPointFrom(1000),
        poolDeposits: [extra, protectedAnchor, futureFirst, futureSecond],
        system: systemState("18"),
      }),
    );

    expect(result).toMatchObject({
      kind: "built",
      actions: { withdrawalRequests: 2 },
      decision: { rebalance: { kind: "withdraw", reason: "excess_ickb_balance" } },
    });
    const withdrawalRequest = buildBaseTransaction.mock.calls[0]?.[1]?.withdrawalRequest;
    expect(withdrawalRequest).toMatchObject({
      deposits: [extra, protectedAnchor],
      requiredLiveDeposits: [futureFirst],
    });
    expect(withdrawalRequest?.deposits).not.toContain(futureFirst);
    expect(withdrawalRequest?.deposits).not.toContain(futureSecond);
  });
});

function systemState(hashByte: string): Parameters<typeof botState>[0]["system"] {
  return {
    feeRate: 1n,
    exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
    orderPool: [],
    ckbAvailable: 0n,
    ckbMaturing: [],
    poolDeposits: { deposits: [], id: "pool" },
    tip: headerLike({
      number: 3n,
      hash: hash(hashByte),
      timestamp: 0n,
      epoch: [0n, 0n, 1n],
    }),
  };
}
