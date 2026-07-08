import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, script } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { OrderCell } from "../../src/model/cells.ts";
import { OrderManager } from "../../src/order.ts";
import { ORDER_CELL_RESOLVE_SUITE } from "../fixtures/order_constants.ts";
import { makeUdtToCkbOrder } from "./support/order_match_helpers.ts";
import {
  directionalInfo,
  dualInfo,
  makeOrderCell,
} from "./support/order_order_helpers.ts";
describe("OrderManager.addMatch", () => {
  it("rejects duplicate partials for the same order cell", () => {
    const manager = new OrderManager(script("11"), [], script("22"));
    const order = makeUdtToCkbOrder();
    const partial = { order, ckbOut: order.ckbValue, udtOut: order.udtValue };

    expect(() =>
      manager.addMatch(ccc.Transaction.default(), {
        ckbDelta: 0n,
        udtDelta: 0n,
        partials: [partial, partial],
      }),
    ).toThrow(`Match contains duplicate order cells: ${order.cell.outPoint.toHex()}`);
  });
});

describe("OrderManager.mint", () => {
  it("creates an order output with the requested CKB value plus occupied capacity", () => {
    const lock = script("11");
    const udt = script("22");
    const manager = new OrderManager(script("33"), [], udt);

    const tx = manager.mint(ccc.Transaction.default(), lock, dualInfo(), {
      ckbValue: ccc.fixedPointFrom(123),
      udtValue: ccc.fixedPointFrom(456),
    });

    expect(tx.outputs).toHaveLength(2);
    const output = tx.getOutput(0);
    if (output === undefined) {
      throw new Error("Expected order output");
    }
    expect(
      OrderCell.mustFrom(
        ccc.Cell.from({
          outPoint: { txHash: byte32FromByte("ef"), index: 0n },
          cellOutput: output.cellOutput,
          outputData: output.outputData,
        }),
      ).ckbUnoccupied,
    ).toBe(ccc.fixedPointFrom(123));
    expect(tx.outputs[0]?.capacity).toBeGreaterThan(ccc.fixedPointFrom(123));
    expect(tx.outputs[0]?.lock.eq(manager.script)).toBe(true);
    expect(tx.outputs[0]?.type?.eq(udt)).toBe(true);
    expect(tx.outputs[1]?.lock.eq(lock)).toBe(true);
    expect(tx.outputs[1]?.type?.eq(manager.script)).toBe(true);
  });
});

describe(ORDER_CELL_RESOLVE_SUITE, () => {
  it("prefers directional progress over a higher-value unprogressed candidate", () => {
    const master = {
      txHash: byte32FromByte("55"),
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
    const progressed = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(50),
      udtValue: ccc.fixedPointFrom(50),
      info,
      master: { type: "absolute", value: master },
      outPoint: { txHash: byte32FromByte("66"), index: 0n },
    });
    const forged = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(200),
      udtValue: 0n,
      info,
      master: { type: "absolute", value: master },
      outPoint: { txHash: byte32FromByte("77"), index: 0n },
    });

    expect(progressed.absProgress).toBeGreaterThan(forged.absProgress);
    expect(forged.absTotal).toBeGreaterThan(progressed.absTotal);
    expect(origin.resolve([forged, progressed])).toBe(progressed);
  });

  it("uses best value for dual-sided orders via absProgress === absTotal", () => {
    const master = {
      txHash: byte32FromByte("88"),
      index: 10n,
    };
    const info = dualInfo();
    const origin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: { type: "absolute", value: master },
      outPoint: { txHash: byte32FromByte("44"), index: 0n },
    });
    const lowerValue = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: { type: "absolute", value: master },
      outPoint: { txHash: byte32FromByte("99"), index: 0n },
    });
    const higherValue = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(60),
      udtValue: ccc.fixedPointFrom(60),
      info,
      master: { type: "absolute", value: master },
      outPoint: { txHash: byte32FromByte("aa"), index: 0n },
    });

    expect(lowerValue.absProgress).toBe(lowerValue.absTotal);
    expect(higherValue.absProgress).toBe(higherValue.absTotal);
    expect(higherValue.absTotal).toBeGreaterThan(lowerValue.absTotal);
    expect(origin.resolve([lowerValue, higherValue])).toBe(higherValue);
  });
});
