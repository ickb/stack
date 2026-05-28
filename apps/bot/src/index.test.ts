import { ccc } from "@ckb-ccc/core";
import { type IckbDepositCell } from "@ickb/core";
import { handleLoopError, logExecution } from "@ickb/node-utils";
import { OrderManager } from "@ickb/order";
import { type IckbSdk } from "@ickb/sdk";
import { defaultFindCellsLimit } from "@ickb/utils";
import { headerLike } from "@ickb/testkit";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CKB_RESERVE, TARGET_ICKB_BALANCE } from "./policy.js";
import {
  completeTerminalIteration,
  isRetryableBotError,
  iterationFailureEventFields,
  readBotState,
  readBotRuntimeConfig,
  reachedMaxRetryableAttempts,
} from "./index.js";
import { BotEventEmitter, transactionLifecycleEvents } from "./observability.js";
import { buildTransaction, collectPoolDeposits } from "./runtime.js";

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
    getL1AccountState: IckbSdk["getL1AccountState"];
    assertCurrentTip: IckbSdk["assertCurrentTip"];
  }>;
  primaryLock?: ccc.Script;
  managers?: Record<string, unknown>;
} = {}): Record<string, unknown> {
  const client: ccc.Client = {};
  const signer: ccc.SignerCkbPrivateKey = {
    getAddressObjs: () => Promise.resolve([]),
  } as never;

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
      ...(overrides.managers ?? {}),
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
      getL1AccountState: async (): Promise<unknown> => {
        await Promise.resolve();
        return {
          system: {
            tip: headerLike(),
            exchangeRatio: { ckbScale: 1n, udtScale: 1n },
            orderPool: [],
            feeRate: 1n,
          },
          user: { orders: [] },
          account: {
            capacityCells: [],
            receipts: [],
          },
        };
      },
      assertCurrentTip: async (): Promise<void> => {
        await Promise.resolve();
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

describe("readBotState", () => {
  it("fails closed when pool scans cross the account-state tip", async () => {
    const tip = headerLike({ number: 10n });
    const assertCurrentTip = vi.fn(async () => {
      await Promise.resolve();
      throw new Error("L1 state scan crossed chain tip; retry with a fresh state");
    });
    const runtime = botRuntime({
      sdk: {
        getL1AccountState: async (): Promise<unknown> => {
          await Promise.resolve();
          return {
            system: {
              tip,
              exchangeRatio: { ckbScale: 1n, udtScale: 1n },
              orderPool: [],
              feeRate: 1n,
            },
            user: { orders: [] },
            account: { capacityCells: [], receipts: [] },
          };
        },
        assertCurrentTip,
      },
      managers: {
        logic: {
          findDeposits: async function* (): AsyncGenerator<IckbDepositCell> {
            await Promise.resolve();
            for (const deposit of [] as IckbDepositCell[]) {
              yield deposit;
            }
          },
        },
      },
    });

    await expect(readBotState(runtime as never)).rejects.toThrow(
      "L1 state scan crossed chain tip; retry with a fresh state",
    );
    expect(assertCurrentTip).toHaveBeenCalledWith(runtime.client, tip);
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

describe("reachedMaxRetryableAttempts", () => {
  it("uses a separate retryable-attempt budget", () => {
    expect(reachedMaxRetryableAttempts(1, 1)).toBe(true);
    expect(reachedMaxRetryableAttempts(1, 2)).toBe(false);
    expect(reachedMaxRetryableAttempts(999, undefined)).toBe(false);
  });
});

describe("bot retryable iteration failures", () => {
  it("treats transport and CKB state-race failures as retryable", () => {
    expect(isRetryableBotError(new Error("L1 state scan crossed chain tip; retry with a fresh state"))).toBe(true);
    expect(isRetryableBotError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryableBotError(new Error("fetch failed", { cause: new TypeError("fetch failed") }))).toBe(true);
    expect(isRetryableBotError(Object.assign(new Error("Client request error PoolRejectedRBF"), {
      code: -1111,
      data: "RBFRejected(\"Tx's current fee is 11795, expect it to >= 12326 to replace old txs\")",
    }))).toBe(true);
    expect(isRetryableBotError(Object.assign(new Error("Client request error TransactionFailedToResolve"), {
      code: -301,
      data: `Resolve(Unknown(OutPoint(0x${"11".repeat(32)}00000000)))`,
    }))).toBe(true);
    expect(isRetryableBotError({
      code: -301,
      data: `Resolve(Dead(OutPoint(0x${"11".repeat(32)}00000000)))`,
    })).toBe(true);
    expect(isRetryableBotError(Object.assign(new Error("Client request error PoolRejectedDuplicatedTransaction"), {
      code: -1107,
      data: `Duplicated(Byte32(0x${"22".repeat(32)}))`,
    }))).toBe(true);
    expect(isRetryableBotError(new Error("fetch failed"))).toBe(false);
    expect(isRetryableBotError({ code: -301, data: "Resolve(InvalidHeader(Byte32(0x...)))" })).toBe(false);
    expect(isRetryableBotError(new Error("deterministic build failure"))).toBe(false);
  });

  it("emits retryability metadata from the same retry decision", () => {
    expect(iterationFailureEventFields(new TypeError("fetch failed"))).toMatchObject({
      retryable: true,
      terminal: false,
      error: { name: "TypeError", message: "fetch failed" },
    });
    expect(iterationFailureEventFields(new TypeError("fetch failed")).error).not.toHaveProperty("stack");

    const stateRaceFailure = iterationFailureEventFields(Object.assign(new Error("Client request error TransactionFailedToResolve"), {
      code: -301,
      data: `Resolve(Unknown(OutPoint(0x${"11".repeat(32)}00000000)))`,
    }));
    expect(stateRaceFailure).toMatchObject({ retryable: true, terminal: false });
    expect(stateRaceFailure.error).not.toHaveProperty("stack");

    const exhaustedFailure = iterationFailureEventFields(new TypeError("fetch failed"), {
      retryableAttempts: 3,
      maxRetryableAttempts: 3,
    });
    expect(exhaustedFailure).toMatchObject({
      retryable: true,
      terminal: true,
      retryableAttempts: 3,
      maxRetryableAttempts: 3,
      retryBudgetExhausted: true,
    });
    expect(exhaustedFailure.error).not.toHaveProperty("stack");

    expect(iterationFailureEventFields(new TypeError("fetch failed"), {
      retryableAttempts: 3,
      maxRetryableAttempts: undefined,
    })).toMatchObject({
      retryable: true,
      terminal: false,
      retryableAttempts: 3,
      retryBudgetExhausted: false,
    });

    const terminalFailure = iterationFailureEventFields(new Error("deterministic build failure"));
    expect(terminalFailure).toMatchObject({
      retryable: false,
      terminal: true,
      error: { name: "Error", message: "deterministic build failure" },
    });
    expect(terminalFailure.error).toHaveProperty("stack");
  });
});

describe("bot private key output boundary", () => {
  it("does not leak the configured canary key across representative crash outputs", async () => {
    const privateKey = `0x${"42".repeat(32)}`;
    const dir = await mkdtemp(join(tmpdir(), "ickb-bot-private-key-boundary-"));
    const output: string[] = [];
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    try {
      const configPath = join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({
        chain: "testnet",
        privateKey,
        sleepIntervalSeconds: 60,
        maxIterations: 1,
      }), { mode: 0o600 });
      const runtimeConfig = await readBotRuntimeConfig({ BOT_CONFIG_FILE: configPath });
      const emitter = new BotEventEmitter({
        chain: runtimeConfig.chain,
        runId: "run-canary-test",
        write: (event): void => {
          output.push(JSON.stringify(event));
        },
      });
      emitter.emit(0, "bot.run.started", {
        runtime: {
          maxIterations: runtimeConfig.maxIterations,
          maxRetryableAttempts: runtimeConfig.maxRetryableAttempts,
          bounded: runtimeConfig.maxIterations !== undefined,
          sleepIntervalMs: runtimeConfig.sleepIntervalMs,
          rpcConfigured: runtimeConfig.rpcUrl !== undefined,
        },
      });
      emitter.emit(0, "bot.chain.preflight", {
        rpcConfigured: runtimeConfig.rpcUrl !== undefined,
        expected: { chain: "testnet", genesisHash: hash("11"), addressPrefix: "ckt" },
        observed: {
          genesisHash: hash("11"),
          addressPrefix: "ckt",
          tip: { hash: hash("22"), number: 1n, timestamp: 2n },
        },
        matches: { genesisHash: true, addressPrefix: true },
      });
      const executionLog: Record<string, unknown> = { startTime: "fixture" };
      handleLoopError(executionLog, new Error("deterministic crash"));
      logExecution(executionLog, new Date());
      emitter.emit(1, "bot.iteration.failed", iterationFailureEventFields(new TypeError("fetch failed")));
      for (const lifecycle of transactionLifecycleEvents({
        type: "pre_broadcast_failed",
        elapsedMs: 1,
        error: new TypeError("fetch failed"),
      })) {
        emitter.emit(1, lifecycle.type, lifecycle.fields);
      }

      const capturedCrashLog = output.join("\n");

      expect(runtimeConfig.privateKey).toBe(privateKey);
      expect(capturedCrashLog).not.toContain(privateKey);
    } finally {
      stdoutWrite.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
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
        maxRetryableAttempts: 3,
      }), { mode: 0o600 });

      await expect(readBotRuntimeConfig({ BOT_CONFIG_FILE: configPath })).resolves.toEqual({
        chain: "testnet",
        privateKey,
        rpcUrl: "http://127.0.0.1:8114/",
        sleepIntervalMs: 60000,
        maxIterations: 1,
        maxRetryableAttempts: 3,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads JSON config files that omit custom RPC URLs", async () => {
    const privateKey = `0x${"11".repeat(32)}`;
    const dir = await mkdtemp(join(tmpdir(), "ickb-bot-config-"));
    try {
      const configPath = join(dir, "config.json");
      await writeFile(configPath, JSON.stringify({
        chain: "testnet",
        privateKey,
        sleepIntervalSeconds: 60,
        maxIterations: 1,
      }), { mode: 0o600 });

      await expect(readBotRuntimeConfig({ BOT_CONFIG_FILE: configPath })).resolves.toEqual({
        chain: "testnet",
        privateKey,
        rpcUrl: undefined,
        sleepIntervalMs: 60000,
        maxIterations: 1,
        maxRetryableAttempts: undefined,
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
    const spent = capacityCell(CKB_RESERVE + 100n, lock, "77");
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      ckbDelta: -1n,
      udtDelta: 0n,
      partials: [{} as never],
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
      availableCkbBalance: CKB_RESERVE + 100n,
      availableIckbBalance: TARGET_ICKB_BALANCE,
      totalCkbBalance: CKB_RESERVE + 100n,
    });

    const result = await buildTransaction(runtime as never, state as never);

    expect(result).toMatchObject({
      kind: "skipped",
      reason: "post_tx_ckb_reserve",
      decision: {
        balances: {
          spendableCkb: 100n,
        },
        skip: {
          reason: "post_tx_ckb_reserve",
          reserve: ccc.fixedPointFrom(1000),
        },
      },
    });
    if (result.kind !== "skipped" || result.decision.skip?.postTxCkbBalance === undefined || result.decision.skip.deficit === undefined) {
      throw new Error("Expected reserve skip details");
    }
    expect(result.decision.skip.deficit).toBe(
      ccc.fixedPointFrom(1000) - result.decision.skip.postTxCkbBalance,
    );
  });

  it("allows CKB-replenishing transactions even when plain CKB remains below reserve", async () => {
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
        completeTransaction: async (txLike: ccc.TransactionLike): Promise<ccc.Transaction> => {
          await Promise.resolve();
          const tx = ccc.Transaction.from(txLike);
          tx.addOutput({ capacity: ccc.fixedPointFrom(500), lock });
          return tx;
        },
      },
    });
    const state = botState({
      accountLocks: [lock],
      capacityCells: [],
      readyWithdrawals: [{}],
      availableCkbBalance: ccc.fixedPointFrom(2000),
      availableIckbBalance: TARGET_ICKB_BALANCE,
      totalCkbBalance: ccc.fixedPointFrom(2000),
    });

    const result = await buildTransaction(runtime as never, state as never);

    expect(result).toMatchObject({
      kind: "built",
      actions: { withdrawals: 1 },
    });
    expect(result.decision.skip).toBeUndefined();
  });

  it("allows withdrawal requests to spend reserve CKB for recovery state rent", async () => {
    const lock = script("11");
    const rent = capacityCell(100n, lock, "80");
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      ckbDelta: 0n,
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
          tx.inputs.push(ccc.CellInput.from({ previousOutput: rent.outPoint }));
          return tx;
        },
      },
    });
    const first = readyDeposit("79", 4n, 20n * 60n * 1000n);
    const protectedAnchor = readyDeposit("7a", 6n, 25n * 60n * 1000n);
    const third = readyDeposit("7b", 5n, 40n * 60n * 1000n);
    const state = botState({
      accountLocks: [lock],
      capacityCells: [rent],
      availableCkbBalance: 0n,
      availableIckbBalance: TARGET_ICKB_BALANCE + 9n,
      totalCkbBalance: 0n,
      depositCapacity: 1000n,
      readyPoolDeposits: [first, protectedAnchor, third],
    });

    const result = await buildTransaction(runtime as never, state as never);

    expect(result).toMatchObject({
      kind: "built",
      actions: { withdrawalRequests: 1 },
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

  it("labels built match and deposit-rebalance decisions", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      ckbDelta: 0n,
      udtDelta: 1n,
      partials: [{} as never],
    });
    vi.spyOn(ccc.Transaction.prototype, "estimateFee").mockReturnValue(1n);

    const lock = script("11");
    const runtime = botRuntime({ primaryLock: lock });
    const state = botState({
      accountLocks: [lock],
      capacityCells: [capacityCell(ccc.fixedPointFrom(2000), lock, "69")],
      marketOrders: [{}],
      availableCkbBalance: ccc.fixedPointFrom(2000),
      availableIckbBalance: 0n,
      depositCapacity: 100n,
      totalCkbBalance: ccc.fixedPointFrom(2000),
    });

    await expect(buildTransaction(runtime as never, state as never)).resolves.toMatchObject({
      kind: "built",
      decision: {
        match: { reason: "matched" },
        rebalance: { kind: "deposit", reason: "low_ickb_balance" },
      },
    });
  });

  it("returns a structured no-action skip with rebalance reason", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      ckbDelta: 0n,
      udtDelta: 0n,
      partials: [],
      diagnostics: {
        orderCount: 1,
        allowance: { ckbValue: 0n, udtValue: 0n },
        ckbAllowanceStep: 1n,
        udtAllowanceStep: 1n,
        ckbMiningFee: 1n,
        directions: {
          ckbToUdt: { matchableCount: 0 },
          udtToCkb: { matchableCount: 1, minAllowance: 1n, maxMatch: 2n },
        },
        candidates: {
          total: 2,
          viable: 1,
          positiveGain: 0,
          rejected: {
            maxPartials: 0,
            duplicateOrder: 0,
            insufficientCkbAllowance: 1,
            insufficientUdtAllowance: 0,
            nonPositiveGain: 1,
          },
          bestGain: 0n,
        },
      },
    });

    const completeTransaction = vi.fn();
    const runtime = botRuntime({ sdk: { completeTransaction } });
    const state = botState({
      marketOrders: [{}],
      availableCkbBalance: 0n,
      availableIckbBalance: TARGET_ICKB_BALANCE,
    });

    await expect(buildTransaction(runtime as never, state as never)).resolves.toMatchObject({
      kind: "skipped",
      reason: "no_actions",
      decision: {
        rebalance: { kind: "none", reason: "target_ickb_not_exceeded" },
        match: {
          reason: "no_positive_gain",
          diagnostics: {
            orderCount: 1,
            directions: {
              udtToCkb: { matchableCount: 1, minAllowance: 1n, maxMatch: 2n },
            },
            candidates: {
              rejected: {
                insufficientCkbAllowance: 1,
                nonPositiveGain: 1,
              },
            },
          },
        },
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

function capacityCell(capacity: bigint, lock: ccc.Script, txByte: string): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: hash(txByte), index: 0n },
    cellOutput: { capacity, lock },
    outputData: "0x",
  });
}
