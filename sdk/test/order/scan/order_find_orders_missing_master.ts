import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, pagedCells, StubClient } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import {
  directionalInfo,
  makeOrderCell,
} from "../matching/support/order_order_helpers.ts";
import { findOrdersFixture, transactionResponse } from "./support/order_scan_helpers.ts";

describe("OrderManager.findOrders missing master", () => {
  it("reports order cells whose master was not found", async () => {
    const { manager, orderScript } = findOrdersFixture();
    const order = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(1000),
      udtValue: 10n,
      info: directionalInfo(),
      lock: orderScript,
      master: { type: "absolute", value: { txHash: byte32FromByte("66"), index: 9n } },
      outPoint: { txHash: byte32FromByte("55"), index: 0n },
    });
    const client = new StubClient({
      findCellsPagedNoCache: pagedCells((query) =>
        query.scriptType === "lock" ? [order.cell] : [],
      ),
      getTransaction: async (): ReturnType<ccc.Client["getTransaction"]> => {
        await Promise.resolve();
        return transactionResponse(ccc.Transaction.default());
      },
    });

    const groups = await manager.findOrders(client);

    expect(groups).toEqual([]);
  });
});
