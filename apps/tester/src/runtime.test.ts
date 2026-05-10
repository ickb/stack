import { ccc } from "@ckb-ccc/core";
import { describe, expect, it, vi } from "vitest";
import {
  buildTransaction,
  readTesterState,
  type Runtime,
  type TesterState,
} from "./runtime.js";

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

function cell(capacity: bigint, lock: ccc.Script, outputData = "0x"): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte("aa"), index: 0n },
    cellOutput: { capacity, lock },
    outputData,
  });
}

describe("readTesterState", () => {
  it("includes receipts and ready withdrawals in the actionable state", async () => {
    const plainLock = script("11");
    const plainCell = cell(5n, plainLock);
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
    const pendingWithdrawal = { owned: { isReady: false }, ckbValue: 31n, udtValue: 0n };
    const runtime: Runtime = {
      client: {} as ccc.Client,
      signer: {} as ccc.SignerCkbPrivateKey,
      sdk: {
        getL1State: async () => {
          await Promise.resolve();
          return {
            system: { tip: { timestamp: 0n } } as TesterState["system"],
            user: { orders: [userOrder, pendingOrder] },
          };
        },
        getAccountState: async () => {
          await Promise.resolve();
          return {
            capacityCells: [plainCell],
            nativeUdtCapacity: 7n,
            nativeUdtBalance: 11n,
            receipts: [receipt],
            withdrawalGroups: [readyWithdrawal, pendingWithdrawal],
          };
        },
      } as unknown as Runtime["sdk"],
      primaryLock: plainLock,
      accountLocks: [plainLock],
    };

    const state = await readTesterState(runtime);

    expect(state.userOrders).toEqual([userOrder, pendingOrder]);
    expect(state.receipts).toEqual([receipt]);
    expect(state.readyWithdrawals).toEqual([readyWithdrawal]);
    expect(state.availableCkbBalance).toBe(
      plainCell.cellOutput.capacity + 23n + 31n + 13n + 19n,
    );
    expect(state.availableIckbBalance).toBe(11n + 29n + 37n + 17n);
  });
});

describe("buildTransaction", () => {
  it("delegates base construction and completion to the SDK", async () => {
    const calls: string[] = [];
    const buildBaseTransaction = vi
      .fn<Runtime["sdk"]["buildBaseTransaction"]>()
      .mockImplementation(async (txLike) => {
        calls.push("base");
        await Promise.resolve();
        return ccc.Transaction.from(txLike);
      });
    const request = vi
      .fn<Runtime["sdk"]["request"]>()
      .mockImplementation(async (txLike) => {
        calls.push("request");
        await Promise.resolve();
        return ccc.Transaction.from(txLike);
      });
    const completeTransaction = vi
      .fn<Runtime["sdk"]["completeTransaction"]>()
      .mockImplementation(async (txLike) => {
        calls.push("complete");
        await Promise.resolve();
        return ccc.Transaction.from(txLike);
      });
    const receipts = [{ id: "receipt" }];
    const readyWithdrawals = [{ id: "withdrawal" }];
    const state: TesterState = {
      system: { feeRate: 42n } as TesterState["system"],
      userOrders: [{ id: "order" }] as unknown as TesterState["userOrders"],
      receipts: receipts as unknown as TesterState["receipts"],
      readyWithdrawals: readyWithdrawals as unknown as TesterState["readyWithdrawals"],
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

    await buildTransaction(
      runtime,
      state,
      { ckbValue: 10n, udtValue: 0n },
      {} as Parameters<Runtime["sdk"]["request"]>[2],
    );

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
});
