import { ccc } from "@ckb-ccc/core";
import {
  byte32FromByte,
  script,
  StubClient,
  headerLike as testHeaderLike,
} from "@ickb/testkit";
import type { State } from "../../../../src/conversion/types.ts";
import { WALLET_LOCK_UP } from "../../../../src/dao.ts";
import { Ratio } from "../../../../src/order/ratio.ts";
import { ckbFromUdt, ICKB_DEPOSIT_CAP } from "../../../../src/udt.ts";
import { headerHash } from "../../../../src/utils/verified_client.ts";

export const hash = byte32FromByte;
export const ratio = Ratio.from({ ckbScale: 1n, udtScale: 1n });
export const baseTip = headerLike(0n);
export const baseClient = new StubClient();

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

/**
 * A state of an empty account at `baseTip`, one to one, with every field the test names
 * replaced: totals and `hasCollectable` are not derived from the positions, so a test sets
 * the ones it reads.
 */
export function state(overrides: Partial<State> = {}): State {
  const exchangeRatio = overrides.exchangeRatio ?? ratio;
  return {
    tip: baseTip,
    feeRate: 1n,
    exchangeRatio,
    depositCapacity: ckbFromUdt(ICKB_DEPOSIT_CAP, exchangeRatio),
    orderBook: [],
    poolDeposits: [],
    poolIckb: 0n,
    poolCkb: 0n,
    apyPercent: 0,
    lockUp: WALLET_LOCK_UP,
    // The fixture signers' lock.
    changeLock: script("11"),
    cells: [],
    receipts: [],
    readyWithdrawals: [],
    pendingWithdrawals: [],
    availableOrders: [],
    pendingOrders: [],
    hasCollectable: false,
    ckbNative: 0n,
    ickbNative: 0n,
    ckbAvailable: 0n,
    ickbAvailable: 0n,
    ckbConvertible: 0n,
    ickbConvertible: 0n,
    ckbBalance: 0n,
    ickbBalance: 0n,
    estimatedMaturity: 0n,
    ...overrides,
  };
}
