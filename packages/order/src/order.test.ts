import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { OrderCell } from "./cells.js";
import { Info, OrderData, Ratio } from "./entities.js";
import { OrderManager, OrderMatcher } from "./order.js";

describe("OrderMatcher", () => {
  it("uses udtToCkb scales for UDT-to-CKB orders", () => {
    const order = makeUdtToCkbOrder();

    const matcher = OrderMatcher.from(order, false, 0n);

    expect(matcher).toBeDefined();
    expect(OrderMatcher.from(order, true, 0n)).toBeUndefined();
    expect(matcher?.aScale).toBe(2n);
    expect(matcher?.bScale).toBe(5n);
    expect(matcher?.bMaxMatch).toBeGreaterThan(0n);
  });

  it("lets bestMatch consume UDT-to-CKB orders", () => {
    const order = makeUdtToCkbOrder();

    const match = OrderManager.bestMatch(
      [order],
      {
        ckbValue: ccc.fixedPointFrom(200),
        udtValue: 0n,
      },
      {
        ckbScale: 3n,
        udtScale: 5n,
      },
      {
        feeRate: 0n,
        ckbAllowanceStep: ccc.fixedPointFrom(1),
      },
    );

    expect(match.partials).toHaveLength(1);
    expect(match.ckbDelta).toBeLessThan(0n);
    expect(match.udtDelta).toBeGreaterThan(0n);
  });

  it("rejects UDT-to-CKB partials below the converted CKB minimum", () => {
    const order = makeUdtToCkbOrder();
    const matcher = OrderMatcher.from(order, false, 0n);

    const belowMinimum = matcher?.match(1n);
    const atMinimum = matcher?.match(3n);

    expect(belowMinimum?.partials).toHaveLength(0);
    expect(atMinimum?.partials).toHaveLength(1);
    expect(atMinimum?.partials[0]?.ckbOut).toBe(ccc.fixedPointFrom(200) + 3n);
    expect(atMinimum?.partials[0]?.udtOut).toBe(ccc.fixedPointFrom(100) - 7n);
  });
});

describe("OrderCell.resolve", () => {
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

  it("does not replace equal-progress non-mint candidates by array order", () => {
    const master = {
      txHash: byte32FromByte("bb"),
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
    const nonMint = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(100),
      udtValue: 0n,
      info,
      master: { type: "absolute", value: master },
      outPoint: { txHash: byte32FromByte("cc"), index: 0n },
    });
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

    expect(origin.resolve([nonMint, otherNonMint])).toBe(nonMint);
    expect(origin.resolve([otherNonMint, nonMint])).toBe(otherNonMint);
  });
});

function makeUdtToCkbOrder(): OrderCell {
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

  return OrderCell.mustFrom(
    ccc.Cell.from({
      outPoint: {
        txHash: byte32FromByte("44"),
        index: 0n,
      },
      cellOutput: {
        capacity: ccc.fixedPointFrom(200),
        lock: orderScript,
        type: udtScript,
      },
      outputData: OrderData.from({
        udtValue: ccc.fixedPointFrom(100),
        master: {
          type: "absolute",
          value: {
            txHash: byte32FromByte("33"),
            index: 1n,
          },
        },
        info: Info.from({
          ckbToUdt: Ratio.empty(),
          udtToCkb: Ratio.from({
            ckbScale: 5n,
            udtScale: 2n,
          }),
          ckbMinMatchLog: 0,
        }),
      }).toBytes(),
    }),
  );
}

function directionalInfo(): Info {
  return Info.from({
    ckbToUdt: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
    udtToCkb: Ratio.empty(),
    ckbMinMatchLog: 0,
  });
}

function dualInfo(): Info {
  const ratio = Ratio.from({ ckbScale: 1n, udtScale: 1n });
  return Info.from({
    ckbToUdt: ratio,
    udtToCkb: ratio,
    ckbMinMatchLog: 0,
  });
}

function makeOrderCell(options: {
  ckbUnoccupied: ccc.FixedPoint;
  udtValue: ccc.FixedPoint;
  info: Info;
  master: {
    type: "relative";
    value: {
      padding: Uint8Array;
      distance: bigint;
    };
  } | {
    type: "absolute";
    value: {
      txHash: `0x${string}`;
      index: bigint;
    };
  };
  outPoint: {
    txHash: `0x${string}`;
    index: bigint;
  };
}): OrderCell {
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
  const outputData = OrderData.from({
    udtValue: options.udtValue,
    master: options.master,
    info: options.info,
  }).toBytes();
  const minimalCell = ccc.Cell.from({
    previousOutput: {
      txHash: byte32FromByte("ff"),
      index: 0n,
    },
    cellOutput: {
      lock: orderScript,
      type: udtScript,
    },
    outputData,
  });

  return OrderCell.mustFrom(
    ccc.Cell.from({
      outPoint: options.outPoint,
      cellOutput: {
        capacity: minimalCell.cellOutput.capacity + options.ckbUnoccupied,
        lock: orderScript,
        type: udtScript,
      },
      outputData,
    }),
  );
}

function byte32FromByte(hexByte: string): `0x${string}` {
  if (!/^[0-9a-f]{2}$/iu.test(hexByte)) {
    throw new Error("Expected exactly one byte as two hex chars");
  }
  return `0x${hexByte.repeat(32)}`;
}
