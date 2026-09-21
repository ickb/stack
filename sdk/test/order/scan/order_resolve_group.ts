import { ccc } from "@ckb-ccc/core";
import { byte32FromByte } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { validatedOrderGroup } from "../../../src/order/cells.ts";
import { Relative } from "../../../src/order/relative.ts";
import {
  absoluteOrderCell,
  directionalInfo,
  makeOrderCell,
} from "../matching/support/order_order_helpers.ts";
import {
  findOrdersFixture,
  masterCell,
  originLookupClient,
} from "./support/order_scan_helpers.ts";

describe("OrderManager.findOrders provenance", () => {
  it("attests a genuinely resolved group for matching and transaction boundaries", async () => {
    const { manager, orderScript, ownerLock } = findOrdersFixture();
    const originMaster = { txHash: byte32FromByte("68"), index: 1n };
    const origin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: { type: "relative", value: Relative.create(1n) },
      lock: orderScript,
      outPoint: { txHash: originMaster.txHash, index: 0n },
    });
    const liveOrder = absoluteOrderCell({
      master: originMaster,
      outPointByte: "69",
      info: directionalInfo(),
      lock: orderScript,
    });
    const liveMaster = masterCell(originMaster, orderScript, ownerLock);
    const originTransaction = ccc.Transaction.default();
    for (const cell of [origin.cell, liveMaster]) {
      originTransaction.outputs.push(cell.cellOutput);
      originTransaction.outputsData.push(cell.outputData);
    }
    const client = originLookupClient({
      liveOrder: liveOrder.cell,
      liveMaster,
      originMasterTxHash: originMaster.txHash,
      originTransaction,
    });

    const [group] = await manager.findOrders(client);

    if (group === undefined) {
      throw new Error("Expected a resolved group");
    }
    expect(validatedOrderGroup(group).order.cell.outPoint.toHex()).toBe(
      liveOrder.cell.outPoint.toHex(),
    );
  });

  it("skips a group whose master carries another order script", async () => {
    const { manager, orderScript, ownerLock } = findOrdersFixture();
    const originMaster = { txHash: byte32FromByte("6a"), index: 1n };
    const origin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: { type: "relative", value: Relative.create(1n) },
      lock: orderScript,
      outPoint: { txHash: originMaster.txHash, index: 0n },
    });
    const liveOrder = absoluteOrderCell({
      master: originMaster,
      outPointByte: "6b",
      info: directionalInfo(),
      lock: orderScript,
    });
    const invalidMaster = masterCell(
      originMaster,
      ccc.Script.from({
        codeHash: orderScript.codeHash,
        hashType: orderScript.hashType,
        args: "0x01",
      }),
      ownerLock,
    );
    const originTransaction = ccc.Transaction.default();
    for (const cell of [origin.cell, invalidMaster]) {
      originTransaction.outputs.push(cell.cellOutput);
      originTransaction.outputsData.push(cell.outputData);
    }
    const client = originLookupClient({
      liveOrder: liveOrder.cell,
      liveMaster: invalidMaster,
      originMasterTxHash: originMaster.txHash,
      originTransaction,
    });

    await expect(manager.findOrders(client)).resolves.toEqual([]);
  });
});
