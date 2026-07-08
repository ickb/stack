import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, script } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { cellInputLike, cellOutputLike } from "../src/io/order_io.ts";
import { OrderConversionRepresentabilityError } from "../src/matching/order_conversion.ts";
import { Info } from "../src/model/info.ts";
import { OrderManager } from "../src/order.ts";
import { makeOrderCell } from "./matching/support/order_order_helpers.ts";

describe("order conversion and I/O", () => {
  it("converts order I/O shapes and rejects unrepresentable quotes", () => {
    const cell = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(1000),
      udtValue: 10n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 1n }),
      master: { type: "absolute", value: { txHash: byte32FromByte("66"), index: 1n } },
      outPoint: { txHash: byte32FromByte("55"), index: 0n },
    }).cell;
    const ownerLock = script("33");

    expect(cellInputLike(cell)).toEqual({
      outPoint: cell.outPoint,
      cellOutput: cellOutputLike(cell.cellOutput),
      outputData: cell.outputData,
    });
    expect(cellOutputLike(cell.cellOutput).type).toEqual(cell.cellOutput.type);
    expect(
      cellOutputLike(ccc.CellOutput.from({ capacity: 1n, lock: ownerLock })).type,
    ).toBeNull();
    expect(() => {
      OrderManager.convert(
        true,
        { ckbScale: 1n, udtScale: 1n },
        { ckbValue: -1n, udtValue: 0n },
      );
    }).toThrow("Order conversion amounts cannot be negative");
    expect(() => {
      OrderManager.convert(
        true,
        { ckbScale: 1n, udtScale: 1n },
        { ckbValue: 0n, udtValue: 0n },
      );
    }).toThrow(OrderConversionRepresentabilityError);
    expect(() => {
      OrderManager.convert(
        true,
        { ckbScale: 1n << 80n, udtScale: 1n },
        { ckbValue: 1n, udtValue: 0n },
      );
    }).toThrow(OrderConversionRepresentabilityError);
  });
});
