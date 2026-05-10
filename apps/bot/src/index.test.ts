import { ccc } from "@ckb-ccc/core";
import { type IckbDepositCell } from "@ickb/core";
import { OrderManager } from "@ickb/order";
import { type IckbSdk } from "@ickb/sdk";
import { defaultFindCellsLimit } from "@ickb/utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatCkb, jsonLogReplacer } from "./log.js";
import { CKB, TARGET_ICKB_BALANCE } from "./policy.js";
import { buildTransaction, collectPoolDeposits, parseSleepInterval } from "./runtime.js";

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

describe("parseSleepInterval", () => {
  it("rejects missing, non-finite, NaN, and sub-second intervals", () => {
    for (const value of [undefined, "", "abc", "NaN", "Infinity", "0", "0.5"]) {
      expect(() => parseSleepInterval(value, "BOT_SLEEP_INTERVAL")).toThrow(
        "Invalid env BOT_SLEEP_INTERVAL",
      );
    }
  });

  it("returns milliseconds for valid second intervals", () => {
    expect(parseSleepInterval("1", "BOT_SLEEP_INTERVAL")).toBe(1000);
    expect(parseSleepInterval("2.5", "BOT_SLEEP_INTERVAL")).toBe(2500);
  });
});

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

describe("bot log formatting", () => {
  it("formats CKB values without losing bigint precision", () => {
    const whole = 123456789012345678901234567890n;

    expect(formatCkb(whole * CKB + 12345670n)).toBe(`${whole.toString()}.1234567`);
    expect(formatCkb(-CKB - 1n)).toBe("-1.00000001");
  });

  it("serializes bigint values as strings", () => {
    expect(jsonLogReplacer("", 9007199254740993n)).toBe("9007199254740993");
  });
});

describe("buildTransaction", () => {
  it("skips match-only transactions when the completed fee consumes the match value", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      ckbDelta: 1n,
      udtDelta: 0n,
      partials: [{} as never],
    });
    vi.spyOn(ccc.Transaction.prototype, "getFee").mockResolvedValue(1n);

    const runtime = {
      client: {} as ccc.Client,
      signer: {} as ccc.SignerCkbPrivateKey,
      managers: {
        order: {
          addMatch: (txLike: ccc.TransactionLike): ccc.Transaction =>
            ccc.Transaction.from(txLike),
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
      },
      primaryLock: ccc.Script.from({
        codeHash: `0x${"11".repeat(32)}`,
        hashType: "type",
        args: "0x",
      }),
    };
    const state = {
      marketOrders: [{}],
      availableCkbBalance: 100n,
      availableIckbBalance: 0n,
      depositCapacity: 100n,
      readyPoolDeposits: [],
      nearReadyPoolDeposits: [],
      futurePoolDeposits: [],
      userOrders: [],
      receipts: [],
      readyWithdrawals: [],
      system: {
        feeRate: 1n,
        exchangeRatio: { ckbScale: 1n, udtScale: 1n },
        tip: {} as ccc.ClientBlockHeader,
      },
    };

    await expect(
      buildTransaction(runtime as never, state as never),
    ).resolves.toBeUndefined();
  });

  it("uses the repo exchange-ratio scale when checking match-only profitability", async () => {
    vi.spyOn(OrderManager, "bestMatch").mockReturnValue({
      ckbDelta: -2n,
      udtDelta: 2n,
      partials: [{} as never],
    });
    vi.spyOn(ccc.Transaction.prototype, "getFee").mockResolvedValue(1n);

    const runtime = {
      client: {} as ccc.Client,
      signer: {} as ccc.SignerCkbPrivateKey,
      managers: {
        order: {
          addMatch: (txLike: ccc.TransactionLike): ccc.Transaction =>
            ccc.Transaction.from(txLike),
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
      },
      primaryLock: script("11"),
    };
    const state = {
      marketOrders: [{}],
      availableCkbBalance: 100n,
      availableIckbBalance: 0n,
      depositCapacity: 100n,
      readyPoolDeposits: [],
      nearReadyPoolDeposits: [],
      futurePoolDeposits: [],
      userOrders: [],
      receipts: [],
      readyWithdrawals: [],
      system: {
        feeRate: 1n,
        exchangeRatio: { ckbScale: 3n, udtScale: 5n },
        tip: {} as ccc.ClientBlockHeader,
      },
    };

    await expect(buildTransaction(runtime as never, state as never)).resolves.toMatchObject({
      actions: { matchedOrders: 1 },
    });
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
    const runtime = {
      client: {} as ccc.Client,
      signer: {} as ccc.SignerCkbPrivateKey,
      managers: {
        order: {
          addMatch: (txLike: ccc.TransactionLike): ccc.Transaction =>
            ccc.Transaction.from(txLike),
        },
      },
      sdk: {
        buildBaseTransaction,
        completeTransaction,
      },
      primaryLock: script("44"),
    };
    const state = {
      marketOrders: [],
      availableCkbBalance: 0n,
      availableIckbBalance: TARGET_ICKB_BALANCE + 9n,
      depositCapacity: 1000n,
      readyPoolDeposits: [first, protectedAnchor, third],
      nearReadyPoolDeposits: [],
      futurePoolDeposits: [],
      userOrders: [],
      receipts: [],
      readyWithdrawals: [],
      system: {
        feeRate: 1n,
        exchangeRatio: { ckbScale: 1n, udtScale: 1n },
        tip: {} as ccc.ClientBlockHeader,
      },
    };

    const result = await buildTransaction(runtime as never, state as never);

    expect(result?.actions.withdrawalRequests).toBe(1);
    expect(buildBaseTransaction.mock.calls[0]?.[2]).toMatchObject({
      withdrawalRequest: {
        deposits: [first],
        requiredLiveDeposits: [protectedAnchor],
      },
    });
    expect(completeTransaction).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["base", "complete"]);
    expect(result?.tx.cellDeps).toEqual([]);
  });
});
