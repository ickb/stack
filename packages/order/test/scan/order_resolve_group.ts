import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, StubClient } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { resolveOrderGroup } from "../../src/io/order_scan.ts";
import { MasterCell } from "../../src/model/cells.ts";
import { Relative } from "../../src/model/relative.ts";
import type { GetTransactionReturn } from "../fixtures/order_constants.ts";
import {
  absoluteOrderCell,
  directionalInfo,
  makeOrderCell,
} from "../matching/support/order_order_helpers.ts";
import {
  findOrdersFixture,
  masterCell,
  transactionResponse,
  transactionWithOutputs,
} from "./support/order_scan_helpers.ts";

const MISSING_ORIGIN = "missing-origin";

describe("resolveOrderGroup", () => {
  it("reports invalid groups after resolving a descendant", async () => {
    const { orderScript, ownerLock } = findOrdersFixture();
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
    const invalidMaster = new MasterCell(
      masterCell(
        originMaster,
        ccc.Script.from({
          codeHash: orderScript.codeHash,
          hashType: orderScript.hashType,
          args: "0x01",
        }),
        ownerLock,
      ),
    );
    const tx = transactionWithOutputs([origin.cell, invalidMaster.cell]);
    const client = new StubClient({
      cache: new ccc.ClientCacheMemory(),
      getTransaction: async (): GetTransactionReturn => {
        await Promise.resolve();
        return transactionResponse(tx);
      },
    });

    const result = await resolveOrderGroup(client, invalidMaster, [liveOrder], (cell) =>
      cell.cellOutput.lock.eq(orderScript),
    );

    expect(result).toEqual({ ok: false, reason: "invalid-group" });
  });

  it("ignores missing transaction outputs while locating an origin", async () => {
    const { orderScript, ownerLock } = findOrdersFixture();
    const originMaster = { txHash: byte32FromByte("6e"), index: 1n };
    const liveOrder = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info: directionalInfo(),
      master: { type: "absolute", value: originMaster },
      lock: orderScript,
      outPoint: { txHash: byte32FromByte("6f"), index: 0n },
    });
    const master = new MasterCell(masterCell(originMaster, orderScript, ownerLock));
    const tx = transactionWithOutputs([liveOrder.cell]);
    const response = transactionResponse(tx);
    response.transaction.getOutput = (): ReturnType<ccc.Transaction["getOutput"]> =>
      undefined;
    const client = new StubClient({
      cache: new ccc.ClientCacheMemory(),
      getTransaction: async (): GetTransactionReturn => {
        await Promise.resolve();
        return response;
      },
    });

    const result = await resolveOrderGroup(client, master, [liveOrder], (cell) =>
      cell.cellOutput.lock.eq(orderScript),
    );

    expect(result).toEqual({ ok: false, reason: MISSING_ORIGIN });
  });
});
