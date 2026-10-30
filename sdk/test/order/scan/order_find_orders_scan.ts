import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, StubClient, type StubCell } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { Relative } from "../../../src/order/relative.ts";
import { defaultCellPageSize } from "../../../src/utils/utils.ts";
import type {
  GetTransactionHash,
  GetTransactionReturn,
} from "../fixtures/order_constants.ts";
import {
  absoluteOrderCell,
  directionalInfo,
  dualInfo,
  makeOrderCell,
} from "../matching/support/order_order_helpers.ts";
import {
  dummyCell,
  findOrdersFixture,
  masterCell,
  transactionResponse,
  transactionWithOutputs,
} from "./support/order_scan_helpers.ts";

const ORDER_CELL_RESOLVE_SUITE = "OrderCell.resolve";
const ORDER_MANAGER_FIND_ORDERS_SUITE = "OrderManager.findOrders";

describe(ORDER_CELL_RESOLVE_SUITE, () => {
  it("fails closed for ambiguous equal-progress non-mint candidates", () => {
    const master = {
      txHash: byte32FromByte("bb"),
      index: 10n,
    };
    const info = directionalInfo();
    const origin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: { type: "relative", value: Relative.create(1n) },
      outPoint: { txHash: master.txHash, index: 9n },
    });
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
    const origin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: { type: "relative", value: Relative.create(1n) },
      outPoint: { txHash: master.txHash, index: 9n },
    });
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
      master: { type: "relative", value: Relative.create(1n) },
      outPoint: { txHash: master.txHash, index: 9n },
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
      // One full page each, then the empty page that ends the scan.
      cells: (query): readonly StubCell[] =>
        query.script_type === "lock"
          ? [
              order.cell,
              ...Array.from({ length: defaultCellPageSize - 1 }, () =>
                dummyCell("38", orderScript, udtScript),
              ),
            ]
          : [
              liveMaster,
              ...Array.from({ length: defaultCellPageSize - 1 }, () =>
                dummyCell("39", ownerLock, orderScript),
              ),
            ],
      getTransaction: async (txHash: GetTransactionHash): GetTransactionReturn => {
        await Promise.resolve();
        return txHash === master.txHash ? transactionResponse(tx) : undefined;
      },
    });

    const groups = await manager.findOrders(client);

    expect(groups).toHaveLength(1);
  });

  it("drops a dual-ratio order at the scan", async () => {
    // Valid on chain, placed by nothing in the stack: left to whoever placed it.
    const { manager, orderScript, ownerLock } = findOrdersFixture();
    const master = ccc.OutPoint.from({ txHash: byte32FromByte("36"), index: 1n });
    const order = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: ccc.fixedPointFrom(100),
      info: dualInfo(),
      master: { type: "absolute", value: master },
      lock: orderScript,
      outPoint: { txHash: byte32FromByte("37"), index: 0n },
    });
    const liveMaster = masterCell(master, orderScript, ownerLock);
    const tx = transactionWithOutputs([
      makeOrderCell({
        ckbUnoccupied: ccc.fixedPointFrom(100),
        udtValue: ccc.fixedPointFrom(100),
        info: dualInfo(),
        master: { type: "relative", value: Relative.create(1n) },
        lock: orderScript,
        outPoint: { txHash: master.txHash, index: 0n },
      }).cell,
      liveMaster,
    ]);
    const client = new StubClient({
      cache: new ccc.ClientCacheMemory(),
      cells: (query): readonly StubCell[] => [
        query.script_type === "lock" ? order.cell : liveMaster,
      ],
      getTransaction: async (txHash: GetTransactionHash): GetTransactionReturn => {
        await Promise.resolve();
        return txHash === master.txHash ? transactionResponse(tx) : undefined;
      },
    });

    await expect(manager.findOrders(client)).resolves.toEqual([]);
  });
});
