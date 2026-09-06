import { ccc } from "@ckb-ccc/core";
import {
  DaoManager,
  getConfig,
  ICKB_DEPOSIT_CAP,
  ickbDepositCellFrom,
  IckbError,
  IckbSdk,
  OrderManager,
  Ratio,
  type IckbDepositCell,
} from "@ickb/sdk";

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
} from "../fixtures/bot.ts";

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

describe("buildTransaction excess withdrawal without a fundable prefix", () => {
  it("proceeds without withdrawals when completion can fund no prefix", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      completeSearchResult({ ckbDelta: 0n, udtDelta: 0n, partials: [] }),
    );
    const state = botState({
      availableCkbBalance: ccc.fixedPointFrom(2000),
      availableIckbBalance: TARGET_ICKB_BALANCE + 9n,
      totalCkbBalance: ccc.fixedPointFrom(2000),
      depositCapacity: 1000n,
      poolDeposits: [
        readyDeposit("82", 4n, 20n * 60n * 1000n),
        readyDeposit("83", 6n, 25n * 60n * 1000n),
        readyDeposit("84", 5n, 40n * 60n * 1000n),
      ],
    });
    const completeTransaction = vi.fn(async () => {
      await Promise.resolve();
      throw new IckbError("short", { code: "insufficient_capacity" });
    });

    const result = await buildTransaction(
      botRuntime({ primaryLock: script("11"), completeTransaction }),
      state,
    );

    // Excess withdrawals have no any-deposit fallback; the turn ends with nothing to do,
    // and the compact ring evidence the policy evaluated stays in the transcript.
    expect(result).toMatchObject({
      kind: "skipped",
      reason: "no_actions",
      decision: {
        rebalance: {
          kind: "none",
          reason: "no_fundable_withdrawal_prefix",
          withdrawalCandidateCount: 2,
        },
        audit: { selectedRing: { poolDepositCount: 3 } },
      },
    });
    expect(completeTransaction).toHaveBeenCalledTimes(2);
  });
});

describe("buildTransaction prefix walk with the real builders", () => {
  it("retries a shorter prefix from a clean base when completion rejects the longer one", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue(
      completeSearchResult({ ckbDelta: 0n, udtDelta: 0n, partials: [] }),
    );
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);
    const config = getConfig("testnet");
    const sdk = IckbSdk.fromConfig(config);
    const deposits = ["a1", "a2", "a3"].map((byte) => realReadyDeposit(byte, config));
    const attempts: number[] = [];
    const completeTransaction = vi.fn(async (txLike: ccc.TransactionLike) => {
      await Promise.resolve();
      const tx = ccc.Transaction.from(txLike);
      attempts.push(tx.inputs.length);
      if (attempts.length === 1) {
        throw new IckbError("short", { code: "insufficient_capacity" });
      }
      return tx;
    });

    const result = await buildTransaction(
      botRuntime({
        sdk: { buildBaseTransaction: sdk.buildBaseTransaction.bind(sdk) },
        managers: config.managers,
        completeTransaction,
      }),
      botState({
        availableCkbBalance: ccc.fixedPointFrom(2000),
        availableIckbBalance: TARGET_ICKB_BALANCE + 2n * ICKB_DEPOSIT_CAP,
        totalCkbBalance: ccc.fixedPointFrom(2000),
        depositCapacity: ccc.fixedPointFrom(100_000),
        poolDeposits: deposits,
      }),
    );

    // Two surplus deposits were candidates; the first attempt spent both, the second
    // attempt starts from the match again and spends one.
    expect(attempts).toEqual([2, 1]);
    expect(result).toMatchObject({
      kind: "built",
      actions: { withdrawalRequests: 1 },
      decision: { rebalance: { withdrawalRequestCount: 1, withdrawalCandidateCount: 2 } },
    });
    if (result.kind !== "built") {
      throw new Error("Expected a built transaction");
    }
    expect(result.tx.inputs).toHaveLength(1);
  });
});

/** A ready pool deposit shaped for the real DAO and owned-owner builders. */
function realReadyDeposit(
  byte: string,
  config: ReturnType<typeof getConfig>,
): IckbDepositCell {
  const tip = headerLike({ epoch: [1n, 0n, 1n], number: 0n });
  const cell = ccc.Cell.from({
    outPoint: { txHash: hash(byte), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100_082),
      lock: config.managers.logic.script,
      type: config.managers.dao.script,
    },
    outputData: DaoManager.depositData(),
  });
  const deposit = ickbDepositCellFrom(
    {
      cell,
      headers: [{ header: tip, txHash: cell.outPoint.txHash }, { header: tip }],
      interests: 0n,
      maturity: ccc.Epoch.from([1n, 0n, 1n]),
      isReady: true,
      isDeposit: true,
      ckbValue: cell.cellOutput.capacity,
      udtValue: 0n,
    },
    config.managers.logic.script,
  );
  Object.assign(deposit, { udtValue: ICKB_DEPOSIT_CAP });
  return deposit;
}
