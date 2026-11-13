import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, StubClient, type StubCell } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { findOrders } from "../../../src/order/order.ts";
import {
  directionalInfo,
  makeOrderCell,
} from "../matching/support/order_order_helpers.ts";
import { transactionResponse } from "./support/order_scan_helpers.ts";

describe("findOrders missing master", () => {
  it("reports order cells whose master was not found", async () => {
    const order = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(1000),
      udtValue: 10n,
      info: directionalInfo(),
      master: { type: "absolute", value: { txHash: byte32FromByte("66"), index: 9n } },
      outPoint: { txHash: byte32FromByte("55"), index: 0n },
    });
    const client = new StubClient({
      cells: (query): readonly StubCell[] =>
        query.script_type === "lock" ? [order.cell] : [],
      getTransaction: async (): ReturnType<ccc.Client["getTransaction"]> => {
        await Promise.resolve();
        return transactionResponse(ccc.Transaction.default());
      },
    });

    const groups = await findOrders(client);

    expect(groups).toEqual([]);
  });
});
