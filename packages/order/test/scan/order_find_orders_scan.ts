import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, StubClient } from "@ickb/testkit";
import { defaultCellPageSize } from "@ickb/utils";
import { describe, expect, it } from "vitest";
import { Relative } from "../../src/model/relative.ts";
import { OrderManager } from "../../src/order.ts";
import {
  mustPageSize,
  NO_CELLS,
  ORDER_CELL_RESOLVE_SUITE,
  ORDER_MANAGER_FIND_ORDERS_SUITE,
  type FindCellsOnChainLimit,
  type FindCellsOnChainOrder,
  type FindCellsOnChainQuery,
  type FindCellsOnChainReturn,
  type GetTransactionHash,
  type GetTransactionReturn,
} from "../fixtures/order_constants.ts";
import {
  absoluteOrderCell,
  directionalInfo,
  makeOrderCell,
} from "../matching/support/order_order_helpers.ts";
import {
  collectOrders,
  dummyCell,
  findOrdersFixture,
  masterCell,
  transactionResponse,
  transactionWithOutputs,
} from "./support/order_scan_helpers.ts";
describe(ORDER_CELL_RESOLVE_SUITE, () => {
  it("fails closed for ambiguous equal-progress non-mint candidates", () => {
    const master = {
      txHash: byte32FromByte("bb"),
      index: 10n,
    };
    const info = directionalInfo();
    const origin = absoluteOrderCell({ master, info, outPointByte: "44" });
    const nonMint = absoluteOrderCell({ master, info, outPointByte: "cc" });
    const otherNonMint = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: {
        type: "absolute",
        value: {
          txHash: master.txHash,
          index: master.index,
        },
      },
      outPoint: { txHash: byte32FromByte("dd"), index: 0n },
    });

    expect(origin.resolve([nonMint, otherNonMint])).toBeUndefined();
    expect(origin.resolve([otherNonMint, nonMint])).toBeUndefined();
  });

  it("prefers a mint candidate over an equal-progress non-mint candidate", () => {
    const master = {
      txHash: byte32FromByte("bc"),
      index: 10n,
    };
    const info = directionalInfo();
    const origin = absoluteOrderCell({ master, info, outPointByte: "44" });
    const nonMint = absoluteOrderCell({ master, info, outPointByte: "ce" });
    const mint = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: {
        type: "relative",
        value: Relative.create(1n),
      },
      outPoint: { txHash: master.txHash, index: 9n },
    });

    expect(mint.getMaster().eq(origin.getMaster())).toBe(true);
    expect(origin.resolve([nonMint, mint])).toBe(mint);
    expect(origin.resolve([mint, nonMint])).toBe(mint);
  });
});

describe(ORDER_CELL_RESOLVE_SUITE, () => {
  it("does not treat duplicate same-outpoint candidates as ambiguous", () => {
    const master = {
      txHash: byte32FromByte("bd"),
      index: 10n,
    };
    const info = directionalInfo();
    const origin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: { type: "absolute", value: master },
      outPoint: { txHash: byte32FromByte("44"), index: 0n },
    });
    const duplicate = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: { type: "absolute", value: master },
      outPoint: { txHash: byte32FromByte("cf"), index: 0n },
    });

    expect(origin.resolve([duplicate, duplicate])).toBe(duplicate);
  });
});

describe(ORDER_MANAGER_FIND_ORDERS_SUITE, () => {
  it("passes the default page size to order scanning", async () => {
    await expectDefaultPageSizeScan("lock");
  });

  it("passes the default page size to master scanning", async () => {
    await expectDefaultPageSizeScan("type");
  });
});

async function expectDefaultPageSizeScan(
  scriptType: FindCellsOnChainQuery["scriptType"],
): Promise<void> {
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
  const manager = new OrderManager(orderScript, [], udtScript);
  let requestedPageSize = 0;
  const client = new StubClient({
    async *findCellsOnChain(
      query: FindCellsOnChainQuery,
      _order: FindCellsOnChainOrder,
      pageSize: FindCellsOnChainLimit,
    ): FindCellsOnChainReturn {
      await Promise.resolve();
      if (query.scriptType !== scriptType) {
        return;
      }
      requestedPageSize = mustPageSize(pageSize);
      yield* NO_CELLS;
    },
  });

  await expect(collectOrders(manager, client)).resolves.toEqual([]);
  expect(requestedPageSize).toBe(defaultCellPageSize);
}

describe(ORDER_MANAGER_FIND_ORDERS_SUITE, () => {
  it("accepts exact page-size order and master scans", async () => {
    const { manager, orderScript, ownerLock, udtScript } = findOrdersFixture();
    const master = ccc.OutPoint.from({
      txHash: byte32FromByte("36"),
      index: 1n,
    });
    const origin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: {
        type: "relative",
        value: Relative.create(1n),
      },
      lock: orderScript,
      outPoint: { txHash: master.txHash, index: 0n },
    });
    const order = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: { type: "absolute", value: master },
      lock: orderScript,
      outPoint: { txHash: byte32FromByte("37"), index: 0n },
    });
    const liveMaster = masterCell(master, orderScript, ownerLock);
    const tx = transactionWithOutputs([origin.cell, liveMaster]);
    const client = new StubClient({
      cache: new ccc.ClientCacheMemory(),
      async *findCellsOnChain(query: FindCellsOnChainQuery): FindCellsOnChainReturn {
        await Promise.resolve();
        if (query.scriptType === "lock") {
          for (let index = 0; index < defaultCellPageSize; index += 1) {
            yield index === 0 ? order.cell : dummyCell("38", orderScript, udtScript);
          }
          return;
        }

        for (let index = 0; index < defaultCellPageSize; index += 1) {
          yield index === 0 ? liveMaster : dummyCell("39", ownerLock, orderScript);
        }
      },
      getTransaction: async (txHash: GetTransactionHash): GetTransactionReturn => {
        await Promise.resolve();
        return txHash === master.txHash ? transactionResponse(tx) : undefined;
      },
    });

    const groups = await collectOrders(manager, client);

    expect(groups).toHaveLength(1);
  });

  it("uses cached scans when onChain is false", async () => {
    const { manager, orderScript, ownerLock, udtScript } = findOrdersFixture();
    let cachedScans = 0;
    const client = new StubClient({
      async *findCells(query: FindCellsOnChainQuery): FindCellsOnChainReturn {
        cachedScans += 1;
        await Promise.resolve();
        yield dummyCell(
          query.scriptType === "lock" ? "71" : "72",
          query.scriptType === "lock" ? orderScript : ownerLock,
          udtScript,
        );
      },
    });

    await expect(
      collectOrders(manager, client, { onChain: false, pageSize: 2 }),
    ).resolves.toEqual([]);
    expect(cachedScans).toBe(2);
  });
});
