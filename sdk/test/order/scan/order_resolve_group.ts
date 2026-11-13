import { ccc } from "@ckb-ccc/core";
import { byte32FromByte } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { ORDER } from "../../../src/constants.ts";
import { findOrders } from "../../../src/order/order.ts";
import { Relative } from "../../../src/order/relative.ts";
import {
  absoluteOrderCell,
  directionalInfo,
  makeOrderCell,
} from "../matching/support/order_order_helpers.ts";
import {
  dummyCell,
  masterCell,
  originLookupClient,
  OWNER_LOCK,
  transactionWithOutputs,
} from "./support/order_scan_helpers.ts";

describe("findOrders provenance", () => {
  it("returns a genuinely resolved group", async () => {
    const originMaster = { txHash: byte32FromByte("68"), index: 1n };
    const origin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: { type: "relative", value: Relative.create(1n) },
      outPoint: { txHash: originMaster.txHash, index: 0n },
    });
    const liveOrder = absoluteOrderCell({
      master: originMaster,
      outPointByte: "69",
      info: directionalInfo(),
    });
    const liveMaster = masterCell(originMaster);
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

    const [group] = await findOrders(client);

    if (group === undefined) {
      throw new Error("Expected a resolved group");
    }
    expect(group.order.cell.outPoint.toHex()).toBe(liveOrder.cell.outPoint.toHex());
  });

  it("never takes the master's own output for its origin", async () => {
    // A master scan answer naming an order's outpoint, the order pointing at itself.
    const originMaster = { txHash: byte32FromByte("6c"), index: 1n };
    const selfPointing = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: { type: "relative", value: Relative.create(0n) },
      outPoint: originMaster,
    });
    const client = originLookupClient({
      liveOrder: selfPointing.cell,
      liveMaster: masterCell(originMaster),
      originMasterTxHash: originMaster.txHash,
      originTransaction: transactionWithOutputs([
        dummyCell("6d", OWNER_LOCK, ORDER),
        selfPointing.cell,
      ]),
    });

    await expect(findOrders(client)).resolves.toEqual([]);
  });

  it("skips a group whose master carries another order script", async () => {
    const originMaster = { txHash: byte32FromByte("6a"), index: 1n };
    const origin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: { type: "relative", value: Relative.create(1n) },
      outPoint: { txHash: originMaster.txHash, index: 0n },
    });
    const liveOrder = absoluteOrderCell({
      master: originMaster,
      outPointByte: "6b",
      info: directionalInfo(),
    });
    const invalidMaster = masterCell(
      originMaster,
      ccc.Script.from({
        codeHash: ORDER.codeHash,
        hashType: ORDER.hashType,
        args: "0x01",
      }),
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

    await expect(findOrders(client)).resolves.toEqual([]);
  });
});
