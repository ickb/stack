import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, committedTransactionResponse, StubClient } from "@ickb/testkit";
import type { OrderGroup } from "../../../src/model/cells.ts";
import { OrderManager } from "../../../src/order.ts";
import type {
  FindCellsOnChainQuery,
  FindCellsOnChainReturn,
  GetTransactionHash,
  GetTransactionReturn,
} from "../../fixtures/order_constants.ts";

type FindOrdersOptions = Parameters<OrderManager["findOrders"]>[1];

export async function collectOrders(
  manager: OrderManager,
  client: ccc.Client,
  options?: FindOrdersOptions,
): Promise<OrderGroup[]> {
  const groups: OrderGroup[] = [];
  for await (const group of manager.findOrders(client, options)) {
    groups.push(group);
  }
  return groups;
}

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
    async *findCellsOnChain(query: FindCellsOnChainQuery): FindCellsOnChainReturn {
      await Promise.resolve();
      if (query.scriptType === "lock") {
        yield liveOrder;
      } else {
        yield liveMaster;
      }
    },
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

export async function collectSkippedOrders(
  manager: OrderManager,
  client: ccc.Client,
): Promise<{ groups: OrderGroup[]; skippedReasons: string[] }> {
  const skippedReasons: string[] = [];
  const groups: OrderGroup[] = [];
  for await (const group of manager.findOrders(client, {
    onSkippedGroup: (reason) => {
      skippedReasons.push(reason);
    },
  })) {
    groups.push(group);
  }
  return { groups, skippedReasons };
}
