import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, script } from "@ickb/testkit";
import { describe, expect, it, vi } from "vitest";
import {
  buildRawOrderTransaction,
  buildSdkConversionTransaction,
  readTesterState,
  type Runtime,
  type TesterState,
} from "./runtime.js";

function cell(capacity: bigint, lock: ccc.Script, outputData = "0x"): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte("aa"), index: 0n },
    cellOutput: { capacity, lock },
    outputData,
  });
}

function buildBaseTransactionMock(calls: string[]): ReturnType<
  typeof vi.fn<Runtime["sdk"]["buildBaseTransaction"]>
> {
  return vi.fn<Runtime["sdk"]["buildBaseTransaction"]>().mockImplementation((txLike) =>
    recordTxStep("base", calls, txLike)
  );
}

function requestMock(calls: string[]): ReturnType<typeof vi.fn<Runtime["sdk"]["request"]>> {
  return vi.fn<Runtime["sdk"]["request"]>().mockImplementation((txLike) =>
    recordTxStep("request", calls, txLike)
  );
}

function completeTransactionMock(calls: string[]): ReturnType<
  typeof vi.fn<Runtime["sdk"]["completeTransaction"]>
> {
  return vi.fn<Runtime["sdk"]["completeTransaction"]>().mockImplementation((txLike) =>
    recordTxStep("complete", calls, txLike)
  );
}

function buildConversionTransactionMock(calls: string[]): ReturnType<
  typeof vi.fn<Runtime["sdk"]["buildConversionTransaction"]>
> {
  return vi.fn<Runtime["sdk"]["buildConversionTransaction"]>().mockImplementation(async (txLike) => {
    calls.push("conversion");
    await Promise.resolve();
    return {
      ok: true,
      tx: ccc.Transaction.from(txLike),
      estimatedMaturity: 0n,
      conversion: { kind: "order" },
    };
  });
}

async function recordTxStep(
  label: string,
  calls: string[],
  txLike: ccc.TransactionLike,
): Promise<ccc.Transaction> {
  calls.push(label);
  await Promise.resolve();
  return ccc.Transaction.from(txLike);
}

describe("readTesterState", () => {
  it("includes receipts and ready withdrawals in the actionable state", async () => {
    const plainLock = script("11");
    const plainCell = cell(5n, plainLock);
    const nativeUdtCell = cell(7n, plainLock, ccc.hexFrom(ccc.numLeToBytes(11n, 16)));
    nativeUdtCell.outPoint.txHash = byte32FromByte("bb");
    const userOrder = {
      ckbValue: 23n,
      udtValue: 29n,
      order: {
        isDualRatio: (): boolean => false,
        isMatchable: (): boolean => false,
      },
    };
    const pendingOrder = {
      ckbValue: 31n,
      udtValue: 37n,
      order: {
        isDualRatio: (): boolean => false,
        isMatchable: (): boolean => true,
      },
    };
    const receipt = { ckbValue: 13n, udtValue: 17n };
    const readyWithdrawal = { owned: { isReady: true }, ckbValue: 19n, udtValue: 0n };
    const pendingWithdrawal = {
      owned: { isReady: false, maturity: { toUnix: (): bigint => 100n } },
      ckbValue: 31n,
      udtValue: 0n,
    };
    const account = {
      capacityCells: [plainCell],
      nativeUdtCells: [nativeUdtCell],
      nativeUdtCapacity: 7n,
      nativeUdtBalance: 11n,
      receipts: [receipt],
      withdrawalGroups: [readyWithdrawal, pendingWithdrawal],
    };
    const runtime: Runtime = {
      client: {} as ccc.Client,
      signer: {} as ccc.SignerCkbPrivateKey,
      sdk: {
        getL1AccountState: async () => {
          await Promise.resolve();
          return {
            system: { tip: { timestamp: 0n } } as TesterState["system"],
            user: { orders: [userOrder, pendingOrder] },
            account,
          };
        },
      } as unknown as Runtime["sdk"],
      primaryLock: plainLock,
      accountLocks: [plainLock],
    };

    const state = await readTesterState(runtime);

    expect(state.userOrders).toEqual([userOrder, pendingOrder]);
    expect(state.account).toBe(account);
    expect(state.conversionContext).toEqual({
      system: { tip: { timestamp: 0n } },
      receipts: [receipt],
      readyWithdrawals: [readyWithdrawal],
      availableOrders: [userOrder, pendingOrder],
      ckbAvailable: plainCell.cellOutput.capacity + 23n + 31n + 13n + 19n,
      ickbAvailable: 11n + 29n + 37n + 17n,
      estimatedMaturity: 100n,
    });
    expect(state.availableCkbBalance).toBe(
      plainCell.cellOutput.capacity + 23n + 31n + 13n + 19n,
    );
    expect(state.availableIckbBalance).toBe(11n + 29n + 37n + 17n);
  });

  it("budgets user orders as available because raw-order transactions collect them", async () => {
    const lock = script("11");
    const userOrder = {
      ckbValue: 23n,
      udtValue: 29n,
      order: {
        isDualRatio: (): boolean => false,
        isMatchable: (): boolean => true,
      },
    };
    const account = emptyAccountState();
    const runtime: Runtime = {
      client: {} as ccc.Client,
      signer: {} as ccc.SignerCkbPrivateKey,
      sdk: {
        getL1AccountState: async () => {
          await Promise.resolve();
          return {
            system: { tip: { timestamp: 0n } } as TesterState["system"],
            user: { orders: [userOrder] },
            account,
          };
        },
      } as unknown as Runtime["sdk"],
      primaryLock: lock,
      accountLocks: [lock],
    };

    const state = await readTesterState(runtime);

    expect(state.userOrders).toEqual([userOrder]);
    expect(state.account).toBe(account);
    expect(state.availableCkbBalance).toBe(userOrder.ckbValue);
    expect(state.availableIckbBalance).toBe(userOrder.udtValue);
  });
});

describe("buildRawOrderTransaction", () => {
  it("delegates base construction and completion to the SDK", async () => {
    const calls: string[] = [];
    const buildBaseTransaction = buildBaseTransactionMock(calls);
    const request = requestMock(calls);
    const completeTransaction = completeTransactionMock(calls);
    const receipts = [{ id: "receipt" }];
    const readyWithdrawals = [{ id: "withdrawal" }];
    const state: TesterState = {
      system: { feeRate: 42n } as TesterState["system"],
      account: emptyAccountState(),
      userOrders: [{ id: "order" }] as unknown as TesterState["userOrders"],
      conversionContext: {
        system: { feeRate: 42n } as TesterState["system"],
        receipts: receipts as unknown as TesterState["conversionContext"]["receipts"],
        readyWithdrawals: readyWithdrawals as unknown as TesterState["conversionContext"]["readyWithdrawals"],
        availableOrders: [],
        ckbAvailable: 0n,
        ickbAvailable: 0n,
        estimatedMaturity: 0n,
      },
      availableCkbBalance: 0n,
      availableIckbBalance: 0n,
    };
    const runtime: Runtime = {
      client: {} as ccc.Client,
      signer: {} as ccc.SignerCkbPrivateKey,
      sdk: {
        buildBaseTransaction,
        completeTransaction,
        request,
      } as unknown as Runtime["sdk"],
      primaryLock: script("11"),
      accountLocks: [],
    };

    await buildRawOrderTransaction(runtime, state, [
      { amounts: { ckbValue: 10n, udtValue: 0n }, info: {} as Parameters<Runtime["sdk"]["request"]>[2] },
    ]);

    expect(buildBaseTransaction.mock.calls[0]?.[2]).toEqual({
      orders: state.userOrders,
      receipts,
      readyWithdrawals,
    });
    expect(completeTransaction.mock.calls[0]?.[1]).toEqual({
      signer: runtime.signer,
      client: runtime.client,
      feeRate: 42n,
    });
    expect(calls).toEqual(["base", "request", "complete"]);
  });

  it("builds multiple raw order requests in one base transaction", async () => {
    const calls: string[] = [];
    const buildBaseTransaction = buildBaseTransactionMock(calls);
    const request = requestMock(calls);
    const completeTransaction = completeTransactionMock(calls);
    const state: TesterState = {
      system: { feeRate: 42n } as TesterState["system"],
      account: emptyAccountState(),
      userOrders: [],
      conversionContext: {
        system: { feeRate: 42n } as TesterState["system"],
        receipts: [],
        readyWithdrawals: [],
        availableOrders: [],
        ckbAvailable: 0n,
        ickbAvailable: 0n,
        estimatedMaturity: 0n,
      },
      availableCkbBalance: 0n,
      availableIckbBalance: 0n,
    };
    const runtime: Runtime = {
      client: {} as ccc.Client,
      signer: {} as ccc.SignerCkbPrivateKey,
      sdk: {
        buildBaseTransaction,
        completeTransaction,
        request,
      } as unknown as Runtime["sdk"],
      primaryLock: script("11"),
      accountLocks: [],
    };

    await buildRawOrderTransaction(runtime, state, [
      { amounts: { ckbValue: 10n, udtValue: 0n }, info: { id: "first" } as Parameters<Runtime["sdk"]["request"]>[2] },
      { amounts: { ckbValue: 20n, udtValue: 0n }, info: { id: "second" } as Parameters<Runtime["sdk"]["request"]>[2] },
    ]);

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map((call) => call[3])).toEqual([
      { ckbValue: 10n, udtValue: 0n },
      { ckbValue: 20n, udtValue: 0n },
    ]);
    expect(calls).toEqual(["base", "request", "request", "complete"]);
  });
});

describe("buildSdkConversionTransaction", () => {
  it("delegates SDK conversion planning to the SDK", async () => {
    const calls: string[] = [];
    const buildConversionTransaction = buildConversionTransactionMock(calls);
    const completeTransaction = completeTransactionMock(calls);
    const state: TesterState = {
      system: { feeRate: 42n } as TesterState["system"],
      account: emptyAccountState(),
      userOrders: [],
      conversionContext: {
        system: { feeRate: 42n } as TesterState["system"],
        receipts: [{ id: "context-receipt" }] as unknown as TesterState["conversionContext"]["receipts"],
        readyWithdrawals: [{ id: "context-withdrawal" }] as unknown as TesterState["conversionContext"]["readyWithdrawals"],
        availableOrders: [{ id: "context-order" }] as unknown as TesterState["conversionContext"]["availableOrders"],
        ckbAvailable: 1000n,
        ickbAvailable: 0n,
        estimatedMaturity: 100n,
      },
      availableCkbBalance: 1000n,
      availableIckbBalance: 0n,
    };
    const primaryLock = script("11");
    const runtime: Runtime = {
      client: {} as ccc.Client,
      signer: {} as ccc.SignerCkbPrivateKey,
      sdk: {
        buildConversionTransaction,
        completeTransaction,
      } as unknown as Runtime["sdk"],
      primaryLock,
      accountLocks: [],
    };

    const result = await buildSdkConversionTransaction(runtime, state, "ckb-to-ickb", 500n);

    expect(result.conversion).toEqual({ kind: "order" });
    expect(buildConversionTransaction.mock.calls[0]?.[2]).toMatchObject({
      direction: "ckb-to-ickb",
      amount: 500n,
      lock: primaryLock,
      context: state.conversionContext,
    });
    expect(completeTransaction.mock.calls[0]?.[1]).toEqual({
      signer: runtime.signer,
      client: runtime.client,
      feeRate: 42n,
    });
    expect(calls).toEqual(["conversion", "complete"]);
  });
});

function emptyAccountState(): TesterState["account"] {
  return {
    capacityCells: [],
    nativeUdtCells: [],
    nativeUdtCapacity: 0n,
    nativeUdtBalance: 0n,
    receipts: [],
    withdrawalGroups: [],
  };
}
