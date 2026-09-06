import { ccc } from "@ckb-ccc/core";
import {
  Info,
  type OrderGroup,
  Ratio,
  type ReceiptCell,
  type SystemState,
  type WithdrawalGroup,
} from "@ickb/sdk";

import { byte32FromByte, script } from "@ickb/testkit";
import { vi } from "vitest";
import type { Runtime, TesterState } from "../../../../src/tester/runtime/runtime.ts";
import { runtimeDefaultSdk } from "./runtimeDefaultSdkFixture.ts";

export type RequestInfo = Parameters<Runtime["sdk"]["request"]>[2];
const client = new ccc.ClientPublicTestnet({ url: "https://example.invalid" });
const signer = new ccc.SignerCkbPrivateKey(client, `0x${"11".repeat(32)}`);
export function cell(capacity: bigint, lock: ccc.Script, outputData = "0x"): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte("aa"), index: 0n },
    cellOutput: { capacity, lock },
    outputData,
  });
}
export function systemState(overrides: Partial<SystemState> = {}): SystemState {
  return {
    feeRate: 42n,
    tip: ccc.ClientBlockHeader.from({
      compactTarget: 0n,
      dao: { c: 0n, ar: 1000n, s: 0n, u: 0n },
      epoch: [0n, 0n, 1n],
      extraHash: byte32FromByte("bb"),
      hash: byte32FromByte("cc"),
      nonce: 0n,
      number: 0n,
      parentHash: byte32FromByte("dd"),
      proposalsHash: byte32FromByte("ee"),
      timestamp: 0n,
      transactionsRoot: byte32FromByte("ff"),
      version: 0n,
    }),
    exchangeRatio: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
    orderPool: [],
    ckbAvailable: 0n,
    ckbMaturing: [],
    poolDeposits: { deposits: [], id: "pool-fixture" },
    ...overrides,
  };
}
export function orderGroup(
  ckbValue: bigint,
  udtValue: bigint,
  isMatchable: boolean,
): OrderGroup {
  const group = {
    ckbValue,
    udtValue,
    order: {
      isDualRatio: (): boolean => false,
      isMatchable: (): boolean => isMatchable,
    },
  };
  if (isOrderGroupFixture(group)) {
    return group;
  }
  throw new Error("Invalid order fixture");
}
function isOrderGroupFixture(value: {
  ckbValue: bigint;
  udtValue: bigint;
  order: { isDualRatio: () => boolean; isMatchable: () => boolean };
}): value is OrderGroup {
  return (
    typeof value.order.isDualRatio() === "boolean" &&
    typeof value.order.isMatchable() === "boolean"
  );
}
export function receipt(ckbValue: bigint, udtValue: bigint): ReceiptCell {
  const value = { ckbValue, udtValue };
  if (isReceiptFixture(value)) {
    return value;
  }
  throw new Error("Invalid receipt fixture");
}
function isReceiptFixture(value: {
  ckbValue: bigint;
  udtValue: bigint;
}): value is ReceiptCell {
  return value.ckbValue >= 0n && value.udtValue >= 0n;
}
export function withdrawal(
  ckbValue: bigint,
  isReady: boolean,
  maturity = 0n,
): WithdrawalGroup {
  const value = {
    owned: { isReady, maturity: { toUnix: (): bigint => maturity } },
    ckbValue,
    udtValue: 0n,
  };
  if (isWithdrawalFixture(value)) {
    return value;
  }
  throw new Error("Invalid withdrawal fixture");
}
function isWithdrawalFixture(value: {
  owned: {
    isReady: boolean;
    maturity: {
      toUnix: (
        reference: Pick<ccc.ClientBlockHeader, "epoch" | "timestamp">,
        epochInMilliseconds?: bigint,
      ) => bigint;
    };
  };
  ckbValue: bigint;
  udtValue: bigint;
}): value is WithdrawalGroup {
  return typeof value.owned.isReady === "boolean";
}
export function requestInfo(id = "request"): RequestInfo {
  return Info.from({
    ckbToUdt: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
    udtToCkb: Ratio.empty(),
    ckbMinMatchLog: id.length,
  });
}

export function emptyAccountState(): TesterState["account"] {
  return {
    capacityCells: [],
    nativeUdtCells: [],
    nativeUdtCapacity: 0n,
    nativeUdtBalance: 0n,
    receipts: [],
    withdrawalGroups: [],
  };
}

export function runtimeWithSdk(sdk: Partial<Runtime["sdk"]>): Runtime {
  return {
    client,
    signer,
    sdk: Object.assign(runtimeDefaultSdk(), sdk),
    primaryLock: script("11"),
    accountLocks: [],
  };
}
export function buildBaseTransactionMock(
  calls: string[],
): ReturnType<typeof vi.fn<Runtime["sdk"]["buildBaseTransaction"]>> {
  return vi
    .fn<Runtime["sdk"]["buildBaseTransaction"]>()
    .mockImplementation((txLike) => recordTxStep("base", calls, txLike));
}
export function requestMock(
  calls: string[],
): ReturnType<typeof vi.fn<Runtime["sdk"]["request"]>> {
  return vi.fn<Runtime["sdk"]["request"]>().mockImplementation(async (txLike) => {
    await Promise.resolve();
    return recordTxStep("request", calls, txLike);
  });
}
export function completeTransactionMock(
  calls: string[],
): ReturnType<typeof vi.fn<Runtime["sdk"]["completeTransaction"]>> {
  return vi
    .fn<Runtime["sdk"]["completeTransaction"]>()
    .mockImplementation(async (txLike) => {
      await Promise.resolve();
      return recordTxStep("complete", calls, txLike);
    });
}
export function buildConversionTransactionMock(
  calls: string[],
): ReturnType<typeof vi.fn<Runtime["sdk"]["buildConversionTransaction"]>> {
  return vi
    .fn<Runtime["sdk"]["buildConversionTransaction"]>()
    .mockImplementation(async (txLike) => {
      calls.push("conversion");
      await Promise.resolve();
      return {
        ok: true,
        tx: ccc.Transaction.from(txLike),
        estimatedMaturity: 0n,
        conversion: { kind: "order" },
        conversionNotice: {
          kind: "maturity-unavailable",
          inputIckb: 500n,
          outputCkb: 499n,
          incentiveCkb: 1n,
          maturityEstimateUnavailable: true,
        },
      };
    });
}
function recordTxStep(
  label: string,
  calls: string[],
  txLike: ccc.TransactionLike,
): ccc.Transaction {
  calls.push(label);
  return ccc.Transaction.from(txLike);
}
