import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, StubClient, headerLike as testHeaderLike } from "@ickb/testkit";
import type {
  ConversionTransactionContext,
  SystemState,
} from "../../../../src/conversion/types.ts";
import { WALLET_LOCK_UP } from "../../../../src/dao.ts";
import { Ratio } from "../../../../src/order/ratio.ts";
import { ckbFromUdt, ICKB_DEPOSIT_CAP } from "../../../../src/udt.ts";
import { headerHash } from "../../../../src/utils/verified_client.ts";

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

/** A real header: its hash is computed from its fields, as the SDK checks every header it reads. */
export function headerLike(
  number: bigint,
  overrides: Partial<Omit<ccc.ClientBlockHeaderLike, "hash">> = {},
): ccc.ClientBlockHeader {
  const fields: Partial<ccc.ClientBlockHeaderLike> = {
    epoch: [1n, 0n, 1n],
    number,
    ...overrides,
  };
  return testHeaderLike({ ...fields, hash: headerHash(testHeaderLike(fields)) });
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
  const { system: systemOverrides, cells = [], ...contextOverrides } = overrides;
  return {
    system: system(systemOverrides),
    receipts: [],
    readyWithdrawals: [],
    availableOrders: [],
    cells,
    ckbAvailable: 0n,
    ickbAvailable: 0n,
    estimatedMaturity: 0n,
    ...contextOverrides,
  };
}

export function system(overrides: Partial<SystemState> = {}): SystemState {
  const exchangeRatio = overrides.exchangeRatio ?? ratio;
  return {
    feeRate: 1n,
    tip: baseTip,
    exchangeRatio,
    depositCapacity: ckbFromUdt(ICKB_DEPOSIT_CAP, exchangeRatio),
    orderPool: [],
    poolDeposits: [],
    lockUp: WALLET_LOCK_UP,
    ...overrides,
  };
}
