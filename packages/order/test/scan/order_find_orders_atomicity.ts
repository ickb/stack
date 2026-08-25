import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, StubClient } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import type { OrderGroup } from "../../src/model/cells.ts";
import { Relative } from "../../src/model/relative.ts";
import {
  ORDER_MANAGER_FIND_ORDERS_SUITE,
  type FindCellsOnChainQuery,
  type FindCellsOnChainReturn,
  type GetTransactionHash,
  type GetTransactionReturn,
} from "../fixtures/order_constants.ts";
import {
  directionalInfo,
  makeOrderCell,
} from "../matching/support/order_order_helpers.ts";
import {
  collectOrders,
  findOrdersFixture,
  masterCell,
  transactionResponse,
  transactionWithOutputs,
} from "./support/order_scan_helpers.ts";

const ORIGIN_LOOKUP_FAILURE = "origin lookup failed";

describe(`${ORDER_MANAGER_FIND_ORDERS_SUITE} resolution atomicity`, () => {
  it("resolves every scanned group", async () => {
    const { manager, client } = twoGroupScan({ failingMasterTxHash: undefined });

    const groups = await collectOrders(manager, client);

    expect(groups).toHaveLength(2);
  });

  it("yields no group when a later origin lookup fails", async () => {
    const { manager, client, secondMasterTxHash } = twoGroupScan({
      failingMasterTxHash: undefined,
    });
    const { manager: failingManager, client: failingClient } = twoGroupScan({
      failingMasterTxHash: secondMasterTxHash,
    });
    const groups: OrderGroup[] = [];

    await expect(
      (async (): Promise<void> => {
        for await (const group of failingManager.findOrders(failingClient)) {
          groups.push(group);
        }
      })(),
    ).rejects.toThrow(ORIGIN_LOOKUP_FAILURE);

    // The first group resolves before the failure, so only buffering hides it.
    expect(groups).toEqual([]);
    await expect(collectOrders(manager, client)).resolves.toHaveLength(2);
  });
});

interface GroupFixture {
  liveOrder: ccc.Cell;
  liveMaster: ccc.Cell;
  masterTxHash: ccc.Hex;
  masterTransaction: ccc.Transaction;
}

function twoGroupScan({
  failingMasterTxHash,
}: {
  failingMasterTxHash: ccc.Hex | undefined;
}): {
  manager: ReturnType<typeof findOrdersFixture>["manager"];
  client: ccc.Client;
  secondMasterTxHash: ccc.Hex;
} {
  const { manager, orderScript, ownerLock } = findOrdersFixture();
  const first = groupFixture("71", "72", orderScript, ownerLock);
  const second = groupFixture("73", "74", orderScript, ownerLock);
  const transactions = new Map([
    [first.masterTxHash, first.masterTransaction],
    [second.masterTxHash, second.masterTransaction],
  ]);
  const client = new StubClient({
    cache: new ccc.ClientCacheMemory(),
    async *findCellsOnChain(query: FindCellsOnChainQuery): FindCellsOnChainReturn {
      await Promise.resolve();
      if (query.scriptType === "lock") {
        yield first.liveOrder;
        yield second.liveOrder;
      } else {
        yield first.liveMaster;
        yield second.liveMaster;
      }
    },
    getTransaction: async (txHash: GetTransactionHash): GetTransactionReturn => {
      await Promise.resolve();
      const requested = ccc.hexFrom(txHash);
      if (requested === failingMasterTxHash) {
        throw new Error(ORIGIN_LOOKUP_FAILURE);
      }
      const transaction = transactions.get(requested);
      return transaction === undefined ? undefined : transactionResponse(transaction);
    },
  });
  return { manager, client, secondMasterTxHash: second.masterTxHash };
}

function groupFixture(
  masterByte: string,
  liveOrderByte: string,
  orderScript: ccc.Script,
  ownerLock: ccc.Script,
): GroupFixture {
  const master = { txHash: byte32FromByte(masterByte), index: 1n };
  const origin = makeOrderCell({
    ckbUnoccupied: ccc.fixedPointFrom(100),
    udtValue: 0n,
    info: directionalInfo(),
    master: { type: "relative", value: Relative.create(1n) },
    lock: orderScript,
    outPoint: { txHash: master.txHash, index: 0n },
  });
  const liveOrder = makeOrderCell({
    ckbUnoccupied: ccc.fixedPointFrom(100),
    udtValue: 0n,
    info: directionalInfo(),
    master: { type: "absolute", value: master },
    lock: orderScript,
    outPoint: { txHash: byte32FromByte(liveOrderByte), index: 0n },
  });
  const liveMaster = masterCell(master, orderScript, ownerLock);
  return {
    liveOrder: liveOrder.cell,
    liveMaster,
    masterTxHash: master.txHash,
    masterTransaction: transactionWithOutputs([origin.cell, liveMaster]),
  };
}
