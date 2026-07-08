import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { MasterCell, OrderCell, OrderGroup } from "../src/model/cells.ts";
import { Info } from "../src/model/info.ts";
import { OrderData } from "../src/model/order_data.ts";
import { Ratio } from "../src/model/ratio.ts";
import { Relative } from "../src/model/relative.ts";

const ORDER_SCRIPT = script("11");
const UDT_SCRIPT = script("22");
const OWNER_LOCK = script("33");

describe("order entity validation", () => {
  it("validates relative pointers and order data", () => {
    const relative = Relative.create(1n);
    const invalidRelative = Relative.from({ padding: new Uint8Array([1]), distance: 1n });
    const info = Info.create(true, { ckbScale: 1n, udtScale: 1n });
    const data = OrderData.from({
      udtValue: 10n,
      master: { type: "relative", value: relative },
      info,
    });

    expect(relative.isValid()).toBe(true);
    expect(invalidRelative.isValid()).toBe(false);
    expect(data.isValid()).toBe(true);
    expect(data.isMint()).toBe(true);
    expect(
      data.getMaster(ccc.OutPoint.from({ txHash: byte32("44"), index: 1n })).index,
    ).toBe(2n);
    expect(() => {
      invalidRelative.validate();
    }).toThrow("Relative master invalid");
    expect(() => {
      OrderData.from({
        udtValue: -1n,
        master: { type: "relative", value: relative },
        info,
      }).validate();
    }).toThrow("udtValue invalid");
    const invalidOutPoint = ccc.OutPoint.from({ txHash: byte32("77"), index: 0n });
    invalidOutPoint.index = -1n;
    expect(() => {
      new OrderData(1n, { type: "absolute", value: invalidOutPoint }, info).validate();
    }).toThrow("OutPoint invalid");
  });

  it("validates order info combinations and comparisons", () => {
    const ckbToUdt = Ratio.from({ ckbScale: 3n, udtScale: 1n });
    const udtToCkb = Ratio.from({ ckbScale: 3n, udtScale: 1n });
    const dual = Info.from({ ckbToUdt, udtToCkb, ckbMinMatchLog: 2 });

    expect(dual.isValid()).toBe(true);
    expect(dual.isDualRatio()).toBe(true);
    expect(dual.getCkbMinMatch()).toBe(4n);
    expect(dual.ckb2UdtCompare(Info.create(true, { ckbScale: 4n, udtScale: 1n }))).toBe(
      -1,
    );
    expect(dual.udt2CkbCompare(Info.create(false, { ckbScale: 2n, udtScale: 1n }))).toBe(
      -1,
    );
    expect(() => {
      Info.from({ ckbToUdt, udtToCkb, ckbMinMatchLog: 65 }).validate();
    }).toThrow("ckbMinMatchLog invalid");
    expect(() => {
      Info.from({
        ckbToUdt: Ratio.empty(),
        udtToCkb: Ratio.empty(),
        ckbMinMatchLog: 0,
      }).validate();
    }).toThrow("ckbToUdt is Empty");
    expect(() => {
      Info.from({
        ckbToUdt: Ratio.from({ ckbScale: 1n, udtScale: 0n }),
        udtToCkb: Ratio.empty(),
        ckbMinMatchLog: 0,
      }).validate();
    }).toThrow("udtToCkb is Empty");
    expect(() => {
      Info.from({
        ckbToUdt: Ratio.from({ ckbScale: 1n, udtScale: 0n }),
        udtToCkb: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
        ckbMinMatchLog: 0,
      }).validate();
    }).toThrow("One ratio is invalid");
    expect(() => {
      Info.from({
        ckbToUdt: Ratio.from({ ckbScale: 1n, udtScale: 10n }),
        udtToCkb: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
        ckbMinMatchLog: 0,
      }).validate();
    }).toThrow("allow order value to be extracted");
  });
});

describe("order cells", () => {
  it("exposes order and master values, matchability, and ownership", () => {
    const order = orderCell({
      ckbValue: ccc.fixedPointFrom(1000),
      udtValue: 10n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 1n }),
    });
    const fulfilled = orderCell({
      ckbValue: 0n,
      udtValue: 0n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 1n }),
    });
    const master = MasterCell.from(masterCell());
    const group = new OrderGroup(master, order, order);

    expect(order.ckbValue).toBe(order.cell.cellOutput.capacity);
    expect(order.udtValue).toBe(10n);
    expect(order.isDualRatio()).toBe(false);
    expect(order.isMatchable()).toBe(true);
    expect(order.isFulfilled()).toBe(false);
    expect(fulfilled.isMatchable()).toBe(false);
    expect(fulfilled.isFulfilled()).toBe(true);
    expect(master.ckbValue).toBe(master.cell.cellOutput.capacity);
    expect(group.ckbValue).toBe(
      order.cell.cellOutput.capacity + master.cell.cellOutput.capacity,
    );
    expect(group.udtValue).toBe(order.data.udtValue);
    expect(group.isOwner(OWNER_LOCK)).toBe(true);
    expect(group.isOwner(script("99"))).toBe(false);
  });
});

describe("order descendant identity", () => {
  it("validates descendant identity invariants", () => {
    const origin = orderCell({
      ckbValue: ccc.fixedPointFrom(1000),
      udtValue: 10n,
      outPointIndex: 0n,
    });
    const same = orderCell({
      ckbValue: ccc.fixedPointFrom(1000),
      udtValue: 10n,
      outPointIndex: 0n,
    });
    const wrongLock = orderCell({
      ckbValue: ccc.fixedPointFrom(1000),
      udtValue: 10n,
      lock: script("99"),
      outPointIndex: 1n,
    });
    const wrongType = orderCell({
      ckbValue: ccc.fixedPointFrom(1000),
      udtValue: 10n,
      udtScript: script("98"),
      outPointIndex: 1n,
    });
    const wrongMaster = orderCell({
      ckbValue: ccc.fixedPointFrom(1000),
      udtValue: 10n,
      masterIndex: 2n,
      outPointIndex: 1n,
    });

    expect(() => {
      origin.validate(same);
    }).not.toThrow();
    expect(() => {
      origin.validate(wrongLock);
    }).toThrow("Order script different");
    expect(() => {
      origin.validate(wrongType);
    }).toThrow("UDT type is different");
    expect(() => {
      origin.validate(wrongMaster);
    }).toThrow("Master is different");
    expect(origin.isValid(wrongLock)).toBe(false);
    expect(origin.resolve([wrongLock])).toBeUndefined();
  });
});

describe("order descendant values", () => {
  it("validates descendant value invariants", () => {
    const origin = orderCell({
      ckbValue: ccc.fixedPointFrom(1000),
      udtValue: 10n,
      outPointIndex: 0n,
    });
    const wrongInfo = orderCell({
      ckbValue: ccc.fixedPointFrom(1000),
      udtValue: 10n,
      info: Info.create(true, { ckbScale: 2n, udtScale: 1n }),
      outPointIndex: 1n,
    });
    const lowerTotal = orderCell({
      ckbValue: ccc.fixedPointFrom(500),
      udtValue: 10n,
      outPointIndex: 1n,
    });
    const udtInfo = Info.create(false, { ckbScale: 1n, udtScale: 1n });
    const udtOrigin = orderCell({
      ckbValue: ccc.fixedPointFrom(1000),
      udtValue: 10n,
      info: udtInfo,
      outPointIndex: 3n,
    });
    const lowerProgress = orderCell({
      ckbValue: ccc.fixedPointFrom(500),
      udtValue: ccc.fixedPointFrom(1000),
      info: udtInfo,
      outPointIndex: 4n,
    });

    expect(() => {
      origin.validate(wrongInfo);
    }).toThrow("Info is different");
    expect(() => {
      origin.validate(lowerTotal);
    }).toThrow("Total value is lower");
    expect(() => {
      udtOrigin.validate(lowerProgress);
    }).toThrow("Progress is lower");
  });
});

describe("order descendant resolution", () => {
  it("resolves to the better descendant", () => {
    const origin = orderCell({
      ckbValue: ccc.fixedPointFrom(1000),
      udtValue: 10n,
      outPointIndex: 0n,
    });
    const better = orderCell({
      ckbValue: ccc.fixedPointFrom(1000),
      udtValue: ccc.fixedPointFrom(20),
      outPointIndex: 5n,
    });
    const worse = orderCell({
      ckbValue: ccc.fixedPointFrom(1000),
      udtValue: ccc.fixedPointFrom(10),
      outPointIndex: 6n,
    });

    expect(origin.resolve([better, worse])).toBe(better);
  });
});

describe("order groups", () => {
  it("validates master cells and order groups", () => {
    const origin = orderCell({
      ckbValue: ccc.fixedPointFrom(1000),
      udtValue: 10n,
      outPointIndex: 0n,
    });

    const master = MasterCell.from(masterCell());
    expect(OrderGroup.tryFrom(master, origin, origin)?.isValid()).toBe(true);
    expect(
      OrderGroup.tryFrom(
        new MasterCell(masterCell({ type: script("99") })),
        origin,
        origin,
      ),
    ).toBeUndefined();
    expect(() => {
      new MasterCell(masterCell({ type: script("99") })).validate(origin);
    }).toThrow("Order script different");
    expect(() => {
      new MasterCell(masterCell({ index: 2n })).validate(origin);
    }).toThrow("Master is different");
  });
});

function orderCell(options: {
  ckbValue: bigint;
  udtValue: bigint;
  info?: Info;
  lock?: ccc.Script;
  udtScript?: ccc.Script;
  masterIndex?: bigint;
  outPointIndex?: bigint;
}): OrderCell {
  const info = options.info ?? Info.create(true, { ckbScale: 1n, udtScale: 1n });
  const index = options.outPointIndex ?? 0n;
  const masterIndex = options.masterIndex ?? 1n;
  const cell = ccc.Cell.from({
    outPoint: { txHash: byte32("55"), index },
    cellOutput: {
      capacity: options.ckbValue,
      lock: options.lock ?? ORDER_SCRIPT,
      type: options.udtScript ?? UDT_SCRIPT,
    },
    outputData: OrderData.from({
      udtValue: options.udtValue,
      master: {
        type: "absolute",
        value: { txHash: byte32("66"), index: masterIndex },
      },
      info,
    }).toBytes(),
  });
  return OrderCell.mustFrom(cell);
}

function masterCell(options?: { index?: bigint; type?: ccc.Script }): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32("66"), index: options?.index ?? 1n },
    cellOutput: { capacity: 61n, lock: OWNER_LOCK, type: options?.type ?? ORDER_SCRIPT },
    outputData: "0x",
  });
}

function script(byte: string): ccc.Script {
  return ccc.Script.from({ codeHash: byte32(byte), hashType: "type", args: "0x" });
}

function byte32(byte: string): `0x${string}` {
  return `0x${byte.repeat(32)}`;
}
