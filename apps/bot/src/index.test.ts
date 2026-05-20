import { ccc } from "@ckb-ccc/core";
import { type IckbDepositCell } from "@ickb/core";
import { OrderManager } from "@ickb/order";
import { type IckbSdk } from "@ickb/sdk";
import { defaultFindCellsLimit } from "@ickb/utils";
import { headerLike } from "@ickb/testkit";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TARGET_ICKB_BALANCE } from "./policy.js";
import { completeTerminalIteration, readBotRuntimeConfig } from "./index.js";
import { buildTransaction, collectPoolDeposits, postTransactionPlainCkbBalance } from "./runtime.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function hash(byte: string): `0x${string}` {
  return `0x${byte.repeat(32)}`;
}

function script(byte: string): ccc.Script {
  return ccc.Script.from({
    codeHash: hash(byte),
    hashType: "type",
    args: "0x",
  });
}

function readyDeposit(
  byte: string,
  udtValue: bigint,
  maturityUnix: bigint,
): IckbDepositCell {
  return {
    cell: ccc.Cell.from({
      outPoint: { txHash: hash(byte), index: 0n },
      cellOutput: {
        capacity: 0n,
        lock: script("22"),
      },
      outputData: "0x",
    }),
    udtValue,
    maturity: {
      toUnix: (): bigint => maturityUnix,
    },
  } as unknown as IckbDepositCell;
}

function botState(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    accountLocks: [],
    capacityCells: [],
    marketOrders: [],
    availableCkbBalance: 0n,
    availableIckbBalance: 0n,
    unavailableCkbBalance: 0n,
    totalCkbBalance: 0n,
    depositCapacity: 100n,
    minCkbBalance: 0n,
    readyPoolDeposits: [],
    nearReadyPoolDeposits: [],
    futurePoolDeposits: [],
    userOrders: [],
    receipts: [],
    readyWithdrawals: [],
    notReadyWithdrawals: [],
    system: {
      feeRate: 1n,
      exchangeRatio: { ckbScale: 1n, udtScale: 1n },
      tip: headerLike(),
    },
    ...overrides,
  };
}

function botRuntime(overrides: {
  sdk?: Partial<{
    buildBaseTransaction: IckbSdk["buildBaseTransaction"];
    completeTransaction: IckbSdk["completeTransaction"];
  }>;
  primaryLock?: ccc.Script;
} = {}): Record<string, unknown> {
  const client: ccc.Client = {};
  const signer: ccc.SignerCkbPrivateKey = {};

  return {
    client,
    signer,
    managers: {
      order: {
        addMatch: (txLike: ccc.TransactionLike): ccc.Transaction =>
          ccc.Transaction.from(txLike),
      },
      logic: {
        deposit: (txLike: ccc.TransactionLike): Promise<ccc.Transaction> =>
          Promise.resolve(ccc.Transaction.from(txLike)),
      },
    },
    sdk: {
      buildBaseTransaction: async (
        txLike: ccc.TransactionLike,
      ): Promise<ccc.Transaction> => {
        await Promise.resolve();
        return ccc.Transaction.from(txLike);
      },
      completeTransaction: async (
        txLike: ccc.TransactionLike,
      ): Promise<ccc.Transaction> => {
        await Promise.resolve();
        return ccc.Transaction.from(txLike);
      },
      ...overrides.sdk,
    },
    primaryLock: overrides.primaryLock ?? script("11"),
  };
}

describe("collectPoolDeposits", () => {
  it("fails closed when the public pool scan reaches the sentinel limit", async () => {
    async function* deposits(): AsyncGenerator<IckbDepositCell> {
      await Promise.resolve();
      for (let index = 0; index <= defaultFindCellsLimit; index += 1) {
        yield readyDeposit("33", 1n, BigInt(index));
      }
    }

    const findDeposits = vi.fn(() => deposits());

    await expect(
      collectPoolDeposits(
        {} as ccc.Client,
        { findDeposits } as never,
        {} as ccc.ClientBlockHeader,
      ),
    ).rejects.toThrow(
      `iCKB pool deposit scan reached limit ${String(defaultFindCellsLimit)}`,
    );

    expect(findDeposits.mock.calls[0]?.[1]).toMatchObject({
      onChain: true,
      limit: defaultFindCellsLimit + 1,
    });
  });
});

describe("completeTerminalIteration", () => {
  it("counts only terminal iterations toward bounded runs", () => {
    expect(completeTerminalIteration(0, 1)).toEqual({
      completedIterations: 1,
      shouldStop: true,
    });
    expect(completeTerminalIteration(0, 2)).toEqual({
      completedIterations: 1,
      shouldStop: false,
    });
    expect(completeTerminalIteration(999, undefined)).toEqual({
      completedIterations: 1000,
      shouldStop: false,
    });
  });
});

describe("readBotRuntimeConfig", () => {
  it("requires a JSON config file", async () => {
    await expect(readBotRuntimeConfig({})).rejects.toThrow("Empty env BOT_CONFIG_FILE");
  });

  it("reads JSON config files", async () => {
    const privateKey = `0x${"11".repeat(32)}`;
    const dir = await mkdtemp(join(tmpdir(), "ickb-bot-config-"));
    try {
      const configPath = join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({
        chain: "testnet",
        privateKey,
        rpcUrl: "http://127.0.0.1:8114/",
        sleepIntervalSeconds: 60,
        maxIterations: 1,
      }), { mode: 0o600 });

      await expect(readBotRuntimeConfig({ BOT_CONFIG_FILE: configPath })).resolves.toEqual({
        chain: "testnet",
        privateKey,
        rpcUrl: "http://127.0.0.1:8114/",
        sleepIntervalMs: 60000,
        maxIterations: 1,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("buildTransaction", () => {
  it("preserves the bot plain CKB reserve when matching orders", async () => {
    const bestMatch = vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      ckbDelta: 0n,
      udtDelta: 0n,
      partials: [],
    });

    await buildTransaction(botRuntime() as never, botState({
      availableCkbBalance: ccc.fixedPointFrom(5000),
      availableIckbBalance: TARGET_ICKB_BALANCE,
    }) as never);

    expect(bestMatch.mock.calls[0]?.[1]).toMatchObject({
      ckbValue: ccc.fixedPointFrom(4000),
    });
  });

  it("skips built transactions that would violate the bot plain CKB reserve", async () => {
    const lock = script("11");
    const spent = capacityCell(1000n, lock, "77");
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      ckbDelta: -1n,
      udtDelta: 0n,
      partials: [{} as never],
    });
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);
    const runtime = botRuntime({
      primaryLock: lock,
      sdk: {
        completeTransaction: async (txLike: ccc.TransactionLike): Promise<ccc.Transaction> => {
          await Promise.resolve();
          const tx = ccc.Transaction.from(txLike);
          tx.inputs.push(ccc.CellInput.from({ previousOutput: spent.outPoint }));
          tx.addOutput({ capacity: 1n, lock });
          return tx;
        },
      },
    });
    const state = botState({
      accountLocks: [lock],
      capacityCells: [spent],
      marketOrders: [{}],
      availableCkbBalance: ccc.fixedPointFrom(5000),
      availableIckbBalance: TARGET_ICKB_BALANCE,
      totalCkbBalance: ccc.fixedPointFrom(5000),
    });

    await expect(buildTransaction(runtime as never, state as never)).resolves.toMatchObject({
      kind: "skipped",
      reason: "post_tx_ckb_reserve",
      decision: { skip: { reason: "post_tx_ckb_reserve" } },
    });
  });

  it("allows CKB-replenishing transactions even when plain CKB remains below reserve", async () => {
    const lock = script("11");
    const spent = capacityCell(1000n, lock, "78");
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      ckbDelta: 1n,
      udtDelta: 0n,
      partials: [],
    });
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);
    const runtime = botRuntime({
      primaryLock: lock,
      sdk: {
        completeTransaction: async (txLike: ccc.TransactionLike): Promise<ccc.Transaction> => {
          await Promise.resolve();
          const tx = ccc.Transaction.from(txLike);
          tx.inputs.push(ccc.CellInput.from({ previousOutput: spent.outPoint }));
          tx.addOutput({ capacity: 1n, lock });
          return tx;
        },
      },
    });
    const state = botState({
      accountLocks: [lock],
      capacityCells: [spent],
      readyWithdrawals: [{}],
      availableCkbBalance: 1000n,
      availableIckbBalance: TARGET_ICKB_BALANCE,
      totalCkbBalance: 1000n,
    });

    const result = await buildTransaction(runtime as never, state as never);

    expect(result).toMatchObject({
      kind: "built",
      actions: { withdrawals: 1 },
    });
    expect(result.decision.skip).toBeUndefined();
  });

  it("skips match-only transactions when the completed fee consumes the match value", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      ckbDelta: 1n,
      udtDelta: 0n,
      partials: [{} as never],
    });
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);

    const lock = script("11");
    const runtime = botRuntime({ primaryLock: lock });
    const state = botState({
      accountLocks: [lock],
      capacityCells: [capacityCell(ccc.fixedPointFrom(2000), lock, "66")],
      marketOrders: [{}],
      availableCkbBalance: 100n,
      availableIckbBalance: TARGET_ICKB_BALANCE,
      totalCkbBalance: 100n,
    });

    await expect(buildTransaction(runtime as never, state as never)).resolves.toMatchObject({
      kind: "skipped",
      reason: "match_value_not_above_fee",
      decision: {
        skip: {
          reason: "match_value_not_above_fee",
          fee: 1n,
          matchValue: 1n,
        },
      },
    });
  });

  it("uses the repo exchange-ratio scale when checking match-only profitability", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      ckbDelta: -2n,
      udtDelta: 2n,
      partials: [{} as never],
    });
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);

    const lock = script("11");
    const runtime = botRuntime({ primaryLock: lock });
    const state = botState({
      accountLocks: [lock],
      capacityCells: [capacityCell(ccc.fixedPointFrom(2000), lock, "67")],
      marketOrders: [{}],
      availableCkbBalance: 100n,
      availableIckbBalance: TARGET_ICKB_BALANCE,
      totalCkbBalance: 100n,
      system: {
        feeRate: 1n,
        exchangeRatio: { ckbScale: 3n, udtScale: 5n },
        tip: headerLike(),
      },
    });

    await expect(buildTransaction(runtime as never, state as never)).resolves.toMatchObject({
      kind: "built",
      actions: { matchedOrders: 1 },
    });
  });

  it("returns a structured no-action skip with rebalance reason", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      ckbDelta: 0n,
      udtDelta: 0n,
      partials: [],
    });

    const completeTransaction = vi.fn();
    const runtime = botRuntime({ sdk: { completeTransaction } });
    const state = botState({
      availableCkbBalance: 0n,
      availableIckbBalance: TARGET_ICKB_BALANCE,
    });

    await expect(buildTransaction(runtime as never, state as never)).resolves.toMatchObject({
      kind: "skipped",
      reason: "no_actions",
      decision: {
        rebalance: { kind: "none", reason: "target_ickb_not_exceeded" },
        actions: {
          collectedOrders: 0,
          completedDeposits: 0,
          matchedOrders: 0,
          deposits: 0,
          withdrawalRequests: 0,
          withdrawals: 0,
        },
        skip: { reason: "no_actions" },
      },
    });
    expect(completeTransaction).not.toHaveBeenCalled();
  });

  it("passes required live deposits to SDK base transaction construction", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      ckbDelta: 0n,
      udtDelta: 0n,
      partials: [],
    });

    const first = readyDeposit("11", 4n, 20n * 60n * 1000n);
    const protectedAnchor = readyDeposit("12", 6n, 25n * 60n * 1000n);
    const third = readyDeposit("13", 5n, 40n * 60n * 1000n);
    const calls: string[] = [];
    const buildBaseTransaction = vi.fn<IckbSdk["buildBaseTransaction"]>();
    buildBaseTransaction.mockImplementation(
      async (txLike: ccc.TransactionLike): Promise<ccc.Transaction> => {
        calls.push("base");
        await Promise.resolve();
        return ccc.Transaction.from(txLike);
      },
    );
    const completeTransaction = vi.fn(
      async (txLike: ccc.TransactionLike): Promise<ccc.Transaction> => {
        calls.push("complete");
        await Promise.resolve();
        expect(calls).toEqual(["base", "complete"]);
        const tx = ccc.Transaction.from(txLike);
        expect(tx.cellDeps).toEqual([]);
        return tx;
      },
    );
    const runtime = botRuntime({
      sdk: { buildBaseTransaction, completeTransaction },
      primaryLock: script("44"),
    });
    const state = botState({
      accountLocks: [script("44")],
      capacityCells: [capacityCell(ccc.fixedPointFrom(2000), script("44"), "68")],
      marketOrders: [],
      availableIckbBalance: TARGET_ICKB_BALANCE + 9n,
      depositCapacity: 1000n,
      readyPoolDeposits: [first, protectedAnchor, third],
    });

    const result = await buildTransaction(runtime as never, state as never);

    expect(result.kind).toBe("built");
    if (result.kind !== "built") {
      throw new Error("Expected built transaction");
    }
    expect(result.actions.withdrawalRequests).toBe(1);
    expect(buildBaseTransaction.mock.calls[0]?.[2]).toMatchObject({
      withdrawalRequest: {
        deposits: [first],
        requiredLiveDeposits: [protectedAnchor],
      },
    });
    expect(completeTransaction).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["base", "complete"]);
    expect(result.tx.cellDeps).toEqual([]);
  });
});

describe("postTransactionPlainCkbBalance", () => {
  it("counts unspent account plain CKB plus account plain outputs", () => {
    const lock = script("11");
    const otherLock = script("22");
    const spent = capacityCell(ccc.fixedPointFrom(1000), lock, "aa");
    const unspent = capacityCell(ccc.fixedPointFrom(2000), lock, "bb");
    const typed = ccc.Cell.from({
      outPoint: { txHash: hash("cc"), index: 0n },
      cellOutput: { capacity: ccc.fixedPointFrom(4000), lock, type: script("33") },
      outputData: "0x",
    });
    const data = ccc.Cell.from({
      outPoint: { txHash: hash("dd"), index: 0n },
      cellOutput: { capacity: ccc.fixedPointFrom(8000), lock },
      outputData: "0x1234",
    });
    const tx = ccc.Transaction.default();
    tx.inputs.push(ccc.CellInput.from({ previousOutput: spent.outPoint }));
    tx.outputs.push(
      ccc.CellOutput.from({ capacity: ccc.fixedPointFrom(300), lock }),
      ccc.CellOutput.from({ capacity: ccc.fixedPointFrom(500), lock, type: script("33") }),
      ccc.CellOutput.from({ capacity: ccc.fixedPointFrom(700), lock: otherLock }),
    );
    tx.outputsData.push("0x", "0x", "0x");

    expect(postTransactionPlainCkbBalance(
      tx,
      botState({ accountLocks: [lock], capacityCells: [spent, unspent, typed, data] }) as never,
    )).toBe(ccc.fixedPointFrom(2300));
  });
});

function capacityCell(capacity: bigint, lock: ccc.Script, txByte: string): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: hash(txByte), index: 0n },
    cellOutput: { capacity, lock },
    outputData: "0x",
  });
}
