import { ccc } from "@ckb-ccc/core";
import { Ratio } from "@ickb/order";
import { byte32FromByte, StubClient, headerLike as testHeaderLike } from "@ickb/testkit";
import type { ConversionTransactionContext, SystemState } from "../../../../src/sdk.ts";

export const hash = byte32FromByte;
export const ratio = Ratio.from({ ckbScale: 1n, udtScale: 1n });
export const baseTip = headerLike(0n);
export const baseClient = new StubClient();

export function dep(byte: string): ccc.CellDep {
  return ccc.CellDep.from({
    outPoint: { txHash: hash(byte), index: 0n },
    depType: "code",
  });
}

export function headerLike(
  number: bigint,
  overrides: Partial<ccc.ClientBlockHeader> = {},
): ccc.ClientBlockHeader {
  return testHeaderLike({
    epoch: [1n, 0n, 1n],
    number,
    ...overrides,
  });
}

export function transactionWithOutputs(count: number, lock: ccc.Script): ccc.Transaction {
  const tx = ccc.Transaction.default();
  for (let index = 0; index < count; index += 1) {
    tx.outputs.push(ccc.CellOutput.from({ capacity: 1n, lock }));
    tx.outputsData.push("0x");
  }
  return tx;
}

export function conversionContext(
  overrides: Partial<Omit<ConversionTransactionContext, "system">> & {
    system?: Partial<SystemState>;
  } = {},
): ConversionTransactionContext {
  const { system: systemOverrides, ...contextOverrides } = overrides;
  return {
    system: system(systemOverrides),
    receipts: [],
    readyWithdrawals: [],
    availableOrders: [],
    ckbAvailable: 0n,
    ickbAvailable: 0n,
    estimatedMaturity: 0n,
    ...contextOverrides,
  };
}

export function system(overrides: Partial<SystemState> = {}): SystemState {
  return {
    feeRate: 1n,
    tip: baseTip,
    exchangeRatio: ratio,
    orderPool: [],
    ckbAvailable: 0n,
    ckbMaturing: [],
    ...overrides,
  };
}
