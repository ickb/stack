import { ccc } from "@ckb-ccc/ccc";
import { Ratio, type OrderGroup } from "@ickb/order";
import { describe, expect, it, vi } from "vitest";
import {
  buildTransactionPreview,
  selectExactCountReadyDepositsUnderAmount,
} from "./transaction.ts";
import type { TransactionContext } from "./transaction.ts";
import type { WalletConfig } from "./utils.ts";

function byte32FromByte(hexByte: string): `0x${string}` {
  if (!/^[0-9a-f]{2}$/iu.test(hexByte)) {
    throw new Error("Expected exactly one byte as two hex chars");
  }
  return `0x${hexByte.repeat(32)}`;
}

function script(codeHashByte: string): ccc.Script {
  return ccc.Script.from({
    codeHash: byte32FromByte(codeHashByte),
    hashType: "type",
    args: "0x",
  });
}

function context(overrides: Partial<TransactionContext> = {}): TransactionContext {
  return {
    system: {
      feeRate: 1n,
      tip: { timestamp: 0n } as ccc.ClientBlockHeader,
      exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
      orderPool: [],
      ckbAvailable: 0n,
      ckbMaturing: [],
    },
    receipts: [],
    readyWithdrawals: [],
    availableOrders: [],
    ckbAvailable: 0n,
    ickbAvailable: 0n,
    estimatedMaturity: 0n,
    ...overrides,
  };
}

function identityTx(txLike: ccc.TransactionLike): ccc.Transaction {
  return ccc.Transaction.from(txLike);
}

function resolvedTx(txLike: ccc.TransactionLike): Promise<ccc.Transaction> {
  return Promise.resolve(ccc.Transaction.from(txLike));
}

function emptyDeposits(): AsyncGenerator<never> {
  return (async function* (): AsyncGenerator<never> {
    await Promise.resolve();
    yield* [] as never[];
  })();
}

function deposits<T>(...values: T[]): AsyncGenerator<T> {
  return (async function* (): AsyncGenerator<T> {
    await Promise.resolve();
    for (const value of values) {
      yield value;
    }
  })();
}

function walletConfig(overrides: Partial<WalletConfig> = {}): WalletConfig {
  return {
    chain: "testnet",
    cccClient: {} as ccc.Client,
    queryClient: {} as WalletConfig["queryClient"],
    signer: {} as ccc.Signer,
    address: "ckt1test",
    accountLocks: [],
    primaryLock: script("11"),
    sdk: {
      buildBaseTransaction: resolvedTx,
      completeTransaction: resolvedTx,
      collect: identityTx,
      request: resolvedTx,
    } as unknown as WalletConfig["sdk"],
    managers: {
      ickbUdt: {
        completeBy: resolvedTx,
      } as unknown as WalletConfig["managers"]["ickbUdt"],
      logic: {
        completeDeposit: identityTx,
        deposit: resolvedTx,
        findDeposits: emptyDeposits,
      } as unknown as WalletConfig["managers"]["logic"],
      ownedOwner: {
        withdraw: resolvedTx,
        requestWithdrawal: resolvedTx,
      } as unknown as WalletConfig["managers"]["ownedOwner"],
      order: {} as WalletConfig["managers"]["order"],
    },
    ...overrides,
  };
}

describe("selectExactCountReadyDepositsUnderAmount", () => {
  it("finds an exact-count subset when the greedy maturity path fails", () => {
    const deposits = [{ udtValue: 6n }, { udtValue: 5n }, { udtValue: 5n }];

    expect(selectExactCountReadyDepositsUnderAmount(deposits as never[], 2, 10n)).toEqual([
      deposits[1],
      deposits[2],
    ]);
  });

  it("prefers the fullest exact-count subset under the cap", () => {
    const deposits = [{ udtValue: 1n }, { udtValue: 4n }, { udtValue: 5n }];

    expect(selectExactCountReadyDepositsUnderAmount(deposits as never[], 2, 10n)).toEqual([
      deposits[1],
      deposits[2],
    ]);
  });

  it("keeps earlier deposits when equally full subsets tie", () => {
    const deposits = [{ udtValue: 5n }, { udtValue: 5n }, { udtValue: 5n }];

    expect(selectExactCountReadyDepositsUnderAmount(deposits as never[], 2, 10n)).toEqual([
      deposits[0],
      deposits[1],
    ]);
  });

  it("bounds the search to the direct-withdrawal preview cap", () => {
    const deposits = [
      ...Array.from({ length: 30 }, () => ({ udtValue: 6n })),
      { udtValue: 5n },
      { udtValue: 5n },
    ];

    expect(selectExactCountReadyDepositsUnderAmount(deposits as never[], 2, 10n)).toEqual([]);
  });

  it("returns no subset when no exact-count fit exists", () => {
    const deposits = [{ udtValue: 6n }, { udtValue: 5n }, { udtValue: 5n }];

    expect(selectExactCountReadyDepositsUnderAmount(deposits as never[], 2, 9n)).toEqual([]);
  });
});

describe("buildTransactionPreview", () => {
  it("reports the preview threshold instead of a generic build failure", async () => {
    vi.spyOn(ccc, "isDaoOutputLimitExceeded").mockResolvedValue(false);
    vi.spyOn(ccc.Transaction.prototype, "completeFeeBy").mockResolvedValue([0, false]);
    vi.spyOn(ccc.Transaction.prototype, "getFee").mockResolvedValue(0n);

    const txInfo = await buildTransactionPreview(
      context({ ckbAvailable: 1n }),
      true,
      1n,
      walletConfig(),
    );

    expect(txInfo.error).toBe(
      "Amount too small to exceed the minimum match and fee threshold",
    );
  });

  it("passes the system fee rate through SDK completion", async () => {
    vi.spyOn(ccc.Transaction.prototype, "getFee").mockResolvedValue(0n);
    const completeTransaction = vi
      .fn<WalletConfig["sdk"]["completeTransaction"]>()
      .mockImplementation(async (txLike) => {
        await Promise.resolve();
        return ccc.Transaction.from(txLike);
      });

    await buildTransactionPreview(
      context({
        availableOrders: [{} as OrderGroup],
        system: {
          ...context().system,
          feeRate: 42n,
        },
      }),
      true,
      0n,
      walletConfig({
        sdk: Object.assign({}, walletConfig().sdk, {
          completeTransaction,
          buildBaseTransaction: async () => {
            await Promise.resolve();
            const tx = ccc.Transaction.default();
            tx.inputs.push(
              ccc.CellInput.from({
                previousOutput: {
                  txHash: byte32FromByte("99"),
                  index: 0n,
                },
              }),
            );
            return tx;
          },
        }) as unknown as WalletConfig["sdk"],
      }),
    );

    expect(completeTransaction.mock.calls[0]?.[1]).toEqual({
      signer: walletConfig().signer,
      client: walletConfig().cccClient,
      feeRate: 42n,
    });
  });

  it("uses SDK completion instead of local UDT, fee, and DAO steps", async () => {
    vi.spyOn(ccc.Transaction.prototype, "getFee").mockResolvedValue(0n);
    const calls: string[] = [];
    const completeBy = vi.fn().mockImplementation(async (txLike: ccc.TransactionLike) => {
      calls.push("udt");
      await Promise.resolve();
      return ccc.Transaction.from(txLike);
    });
    const completeFeeBy = vi
      .spyOn(ccc.Transaction.prototype, "completeFeeBy")
      .mockImplementation(() => {
        calls.push("fee");
        return Promise.resolve([0, false]);
      });
    const daoLimit = vi.spyOn(ccc, "isDaoOutputLimitExceeded").mockImplementation(() => {
      calls.push("dao-limit");
      return Promise.resolve(false);
    });
    const completeTransaction = vi
      .fn<WalletConfig["sdk"]["completeTransaction"]>()
      .mockImplementation(async (txLike) => {
        calls.push("sdk-complete");
        await Promise.resolve();
        return ccc.Transaction.from(txLike);
      });

    await buildTransactionPreview(
      context({ availableOrders: [{} as OrderGroup] }),
      true,
      0n,
      walletConfig({
        sdk: Object.assign({}, walletConfig().sdk, {
          completeTransaction,
          buildBaseTransaction: async () => {
            await Promise.resolve();
            const tx = ccc.Transaction.default();
            tx.inputs.push(
              ccc.CellInput.from({
                previousOutput: {
                  txHash: byte32FromByte("77"),
                  index: 0n,
                },
              }),
            );
            return tx;
          },
        }) as unknown as WalletConfig["sdk"],
        managers: Object.assign({}, walletConfig().managers, {
          ickbUdt: { completeBy } as unknown as WalletConfig["managers"]["ickbUdt"],
        }),
      }),
    );

    expect(completeTransaction).toHaveBeenCalledTimes(1);
    expect(completeBy).not.toHaveBeenCalled();
    expect(completeFeeBy).not.toHaveBeenCalled();
    expect(daoLimit).not.toHaveBeenCalled();
    expect(calls).toEqual(["sdk-complete"]);
  });

  it("passes direct withdrawal requests through the SDK base builder", async () => {
    vi.spyOn(ccc.Transaction.prototype, "getFee").mockResolvedValue(0n);
    const buildBaseTransaction = vi
      .fn<WalletConfig["sdk"]["buildBaseTransaction"]>()
      .mockImplementation(async (txLike) => {
        await Promise.resolve();
        return ccc.Transaction.from(txLike);
      });
    const request = vi
      .fn<WalletConfig["sdk"]["request"]>()
      .mockImplementation(async (txLike) => {
        await Promise.resolve();
        return ccc.Transaction.from(txLike);
      });
    const readyDeposit = {
      isReady: true,
      udtValue: 10n,
      maturity: { toUnix: (): bigint => 5n },
    };

    const txInfo = await buildTransactionPreview(
      context({ ickbAvailable: 10n }),
      false,
      10n,
      walletConfig({
        sdk: Object.assign({}, walletConfig().sdk, {
          buildBaseTransaction,
          request,
        }) as unknown as WalletConfig["sdk"],
        managers: Object.assign({}, walletConfig().managers, {
          logic: Object.assign({}, walletConfig().managers.logic, {
            findDeposits: () => deposits(readyDeposit),
          }),
        }),
      }),
    );

    expect(txInfo.error).toBe("");
    expect(buildBaseTransaction).toHaveBeenCalledTimes(2);
    expect(buildBaseTransaction.mock.calls[0]?.[2]).toEqual({
      withdrawalRequest: undefined,
      orders: [],
      receipts: [],
      readyWithdrawals: [],
    });
    expect(buildBaseTransaction.mock.calls[1]?.[2]).toEqual({
      withdrawalRequest: {
        deposits: [readyDeposit],
        lock: script("11"),
      },
      orders: [],
      receipts: [],
      readyWithdrawals: [],
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps UDT-to-CKB fallback preview buildable under live-like ratios", async () => {
    vi.spyOn(ccc.Transaction.prototype, "getFee").mockResolvedValue(0n);
    const request = vi
      .fn<WalletConfig["sdk"]["request"]>()
      .mockImplementation(async (txLike) => {
        await Promise.resolve();
        return ccc.Transaction.from(txLike);
      });

    const txInfo = await buildTransactionPreview(
      context({
        system: {
          ...context().system,
          exchangeRatio: Ratio.from({
            ckbScale: 10000000000000000n,
            udtScale: 10100000000000000n,
          }),
          ckbAvailable: ccc.fixedPointFrom(1000000),
          tip: { timestamp: 1234n } as ccc.ClientBlockHeader,
        },
        ickbAvailable: ccc.fixedPointFrom(10000),
      }),
      false,
      ccc.fixedPointFrom(10000),
      walletConfig({
        sdk: Object.assign({}, walletConfig().sdk, {
          request,
        }) as unknown as WalletConfig["sdk"],
      }),
    );

    expect(txInfo.error).toBe("");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
