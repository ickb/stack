import { ccc } from "@ckb-ccc/core";
import {
  byte32FromByte,
  script,
  StubClient,
  headerLike as testHeaderLike,
  transactionWithHeader,
  type TransactionWithHeader,
} from "@ickb/testkit";
import type { DaoDepositCell } from "../../src/cells.ts";
import { DaoManager } from "../../src/dao.ts";

export const REQUEST_WITHDRAWAL_SUITE = "DaoManager.requestWithdrawal";
export const FIND_DEPOSITS_SUITE = "DaoManager.findDeposits";
export const FIND_WITHDRAWAL_REQUESTS_SUITE = "DaoManager.findWithdrawalRequests";

export async function collect<T>(inputs: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const input of inputs) {
    result.push(input);
  }
  return result;
}

export function headerWithHash(number: bigint, hashByte: string): ccc.ClientBlockHeader {
  const header = headerLike(number);
  return ccc.ClientBlockHeader.from({
    compactTarget: header.compactTarget,
    dao: header.dao,
    epoch: header.epoch,
    extraHash: header.extraHash,
    hash: byte32FromByte(hashByte),
    nonce: header.nonce,
    number: header.number,
    parentHash: header.parentHash,
    proposalsHash: header.proposalsHash,
    timestamp: header.timestamp,
    transactionsRoot: header.transactionsRoot,
    version: header.version,
  });
}

export function depositCell(
  manager: DaoManager,
  options?: {
    lock?: ccc.Script;
    txHashByte?: string;
    isReady?: boolean;
  },
): DaoDepositCell {
  const depositHeader = headerLike(1n);
  const txHash = byte32FromByte(options?.txHashByte ?? "22");
  return {
    cell: ccc.Cell.from({
      outPoint: {
        txHash,
        index: 0n,
      },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: options?.lock ?? script("33"),
        type: manager.script,
      },
      outputData: DaoManager.depositData(),
    }),
    isDeposit: true,
    headers: [{ header: depositHeader, txHash }, { header: depositHeader }],
    interests: 0n,
    maturity: ccc.Epoch.from([1n, 0n, 1n]),
    isReady: options?.isReady ?? true,
    ckbValue: ccc.fixedPointFrom(100082),
    udtValue: 0n,
  };
}

export function headerLike(number: bigint): ccc.ClientBlockHeader {
  return testHeaderLike({
    epoch: [1n, 0n, 1n],
    number,
  });
}

export function client(): ccc.Client {
  return new StubClient();
}

export {
  byte32FromByte,
  script,
  StubClient,
  transactionWithHeader,
  type TransactionWithHeader,
};
