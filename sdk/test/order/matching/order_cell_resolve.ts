import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, script } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import { OrderCell } from "../../../src/order/cells.ts";
import { OrderManager } from "../../../src/order/order.ts";
import { Relative } from "../../../src/order/relative.ts";
import { ORDER_CELL_RESOLVE_SUITE } from "../fixtures/order_constants.ts";
import {
  directionalInfo,
  dualInfo,
  makeOrderCell,
} from "./support/order_order_helpers.ts";
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
      master: { type: "relative", value: Relative.create(1n) },
      outPoint: { txHash: master.txHash, index: 9n },
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
      master: { type: "relative", value: Relative.create(1n) },
      outPoint: { txHash: master.txHash, index: 9n },
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

describe(ORDER_CELL_RESOLVE_SUITE, () => {
  it("rejects higher progress that underfunds the mint baseline", () => {
    const master = { txHash: byte32FromByte("af"), index: 10n };
    const info = directionalInfo();
    const origin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: { type: "relative", value: Relative.create(1n) },
      outPoint: { txHash: master.txHash, index: 9n },
    });
    const underfunded = makeOrderCell({
      ckbUnoccupied: 0n,
      udtValue: ccc.fixedPointFrom(50),
      info,
      master: { type: "absolute", value: master },
      outPoint: { txHash: byte32FromByte("b3"), index: 0n },
    });

    expect(underfunded.absProgress).toBeGreaterThan(origin.absProgress);
    expect(underfunded.absTotal).toBeLessThan(origin.absTotal);
    expect(origin.isValid(underfunded)).toBe(false);
    expect(origin.resolve([underfunded])).toBeUndefined();
  });

  it("uses total value to resolve equal-progress descendants", () => {
    const master = { txHash: byte32FromByte("ab"), index: 10n };
    const info = directionalInfo();
    const origin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: { type: "relative", value: Relative.create(1n) },
      outPoint: { txHash: master.txHash, index: 9n },
    });
    const lowerValue = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(90),
      udtValue: ccc.fixedPointFrom(10),
      info,
      master: { type: "absolute", value: master },
      outPoint: { txHash: byte32FromByte("ac"), index: 0n },
    });
    const higherValue = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: ccc.fixedPointFrom(10),
      info,
      master: { type: "absolute", value: master },
      outPoint: { txHash: byte32FromByte("ad"), index: 0n },
    });

    expect(lowerValue.absProgress).toBe(higherValue.absProgress);
    expect(higherValue.absTotal).toBeGreaterThan(lowerValue.absTotal);
    expect(origin.resolve([higherValue, lowerValue])).toBe(higherValue);
    expect(origin.resolve([lowerValue, higherValue])).toBe(higherValue);
  });

  it("accepts a distinct better descendant after an equal-score ambiguity", () => {
    const master = { txHash: byte32FromByte("ae"), index: 10n };
    const info = directionalInfo();
    const origin = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: { type: "relative", value: Relative.create(1n) },
      outPoint: { txHash: master.txHash, index: 9n },
    });
    const descendant = (byte: string, ckb: bigint, udt: bigint): OrderCell =>
      makeOrderCell({
        ckbUnoccupied: ckb,
        udtValue: udt,
        info,
        master: { type: "absolute", value: master },
        outPoint: { txHash: byte32FromByte(byte), index: 0n },
      });
    const equalA = descendant("b0", ccc.fixedPointFrom(90), ccc.fixedPointFrom(10));
    const equalB = descendant("b1", ccc.fixedPointFrom(90), ccc.fixedPointFrom(10));
    const better = descendant("b2", ccc.fixedPointFrom(80), ccc.fixedPointFrom(20));

    expect(origin.resolve([equalA, equalB])).toBeUndefined();
    expect(origin.resolve([equalA, equalB, better])).toBe(better);
  });
});
