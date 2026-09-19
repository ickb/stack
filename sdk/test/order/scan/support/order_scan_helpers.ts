import { ccc } from "@ckb-ccc/core";
import {
  byte32FromByte,
  committedTransactionResponse,
  pagedCells,
  StubClient,
} from "@ickb/testkit";
import { OrderManager } from "../../../../src/order/order.ts";
import type {
  GetTransactionHash,
  GetTransactionReturn,
} from "../../fixtures/order_constants.ts";

export interface FindOrdersFixture {
  manager: OrderManager;
  orderScript: ccc.Script;
  ownerLock: ccc.Script;
  udtScript: ccc.Script;
}

export function findOrdersFixture(): FindOrdersFixture {
  const orderScript = ccc.Script.from({
    codeHash: byte32FromByte("11"),
    hashType: "type",
    args: "0x",
  });
  const udtScript = ccc.Script.from({
    codeHash: byte32FromByte("22"),
    hashType: "type",
    args: "0x",
  });
  const ownerLock = ccc.Script.from({
    codeHash: byte32FromByte("44"),
    hashType: "type",
    args: "0x",
  });
  return {
    manager: new OrderManager(orderScript, [], udtScript),
    orderScript,
    ownerLock,
    udtScript,
  };
}

export function masterCell(
  outPoint: ccc.OutPointLike,
  orderScript: ccc.Script,
  ownerLock: ccc.Script,
): ccc.Cell {
  return ccc.Cell.from({
    outPoint,
    cellOutput: {
      capacity: ccc.fixedPointFrom(61),
      lock: ownerLock,
      type: orderScript,
    },
    outputData: "0x",
  });
}

export function originLookupClient({
  liveOrder,
  liveMaster,
  originMasterTxHash,
  originTransaction,
}: {
  liveOrder: ccc.Cell;
  liveMaster: ccc.Cell;
  originMasterTxHash: ccc.Hex;
  originTransaction: ccc.Transaction;
}): ccc.Client {
  return new StubClient({
    cache: new ccc.ClientCacheMemory(),
    findCellsPagedNoCache: pagedCells((query) =>
      query.scriptType === "lock" ? [liveOrder] : [liveMaster],
    ),
    getTransaction: async (txHash: GetTransactionHash): GetTransactionReturn => {
      await Promise.resolve();
      return txHash === originMasterTxHash
        ? transactionResponse(originTransaction)
        : undefined;
    },
  });
}

export function transactionResponse(tx: ccc.Transaction): ccc.ClientTransactionResponse {
  return committedTransactionResponse(tx);
}

export function transactionWithOutputs(cells: ccc.Cell[]): ccc.Transaction {
  const tx = ccc.Transaction.default();
  for (const cell of cells) {
    tx.outputs.push(cell.cellOutput);
    tx.outputsData.push(cell.outputData);
  }
  return tx;
}

export function dummyCell(byte: string, lock: ccc.Script, type: ccc.Script): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte(byte), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(61),
      lock,
      type,
    },
    outputData: "0x",
  });
}
