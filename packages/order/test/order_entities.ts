import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { MasterCell, OrderCell, OrderGroup } from "../src/model/cells.ts";
import { Info } from "../src/model/info.ts";
import { OrderData } from "../src/model/order_data.ts";
import { Ratio } from "../src/model/ratio.ts";
import { Relative } from "../src/model/relative.ts";
import { resolvedOrderGroup } from "./matching/support/order_match_helpers.ts";

const ORDER_SCRIPT = script("11");
const UDT_SCRIPT = script("22");
const OWNER_LOCK = script("33");
const ORDER_OUT_POINT_HEX = `${byte32("55")}00000000`;
const MINT_ORDER_DATA_HEX =
  "0x09000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000fbffffff020000000000000003000000000000000000000000000000000000000000000000";
const MATCH_ORDER_DATA_HEX =
  "0x0d0000000000000000000000000000000100000007070707070707070707070707070707070707070707070707070707070707070b000000050000000000000008000000000000000000000000000000000000000000000000";

describe("order data golden vectors", () => {
  it("matches the Rust mint order data golden vector", () => {
    const encoded = OrderData.from({
      udtValue: 9n,
      master: { type: "relative", value: Relative.create(-5n) },
      info: Info.from({
        ckbToUdt: Ratio.from({ ckbScale: 2n, udtScale: 3n }),
        udtToCkb: Ratio.empty(),
        ckbMinMatchLog: 0,
      }),
    }).toBytes();

    expect(encoded).toHaveLength(89);
    expect(ccc.hexFrom(encoded)).toBe(MINT_ORDER_DATA_HEX);

    const decoded = OrderData.decode(MINT_ORDER_DATA_HEX);
    expect(decoded.udtValue).toBe(9n);
    expect(decoded.master.type).toBe("relative");
    if (decoded.master.type !== "relative") {
      throw new Error("Expected relative master");
    }
    expect(ccc.hexFrom(decoded.master.value.padding)).toBe(
      ccc.hexFrom(Relative.padding()),
    );
    expect(decoded.master.value.distance).toBe(-5n);
    expect(decoded.info.ckbToUdt.ckbScale).toBe(2n);
    expect(decoded.info.ckbToUdt.udtScale).toBe(3n);
    expect(decoded.info.udtToCkb).toEqual(Ratio.empty());
    expect(decoded.info.ckbMinMatchLog).toBe(0);
  });

  it("matches the Rust matched order data golden vector", () => {
    const encoded = OrderData.from({
      udtValue: 13n,
      master: {
        type: "absolute",
        value: { txHash: byte32("07"), index: 11n },
      },
      info: Info.from({
        ckbToUdt: Ratio.from({ ckbScale: 5n, udtScale: 8n }),
        udtToCkb: Ratio.empty(),
        ckbMinMatchLog: 0,
      }),
    }).toBytes();

    expect(encoded).toHaveLength(89);
    expect(ccc.hexFrom(encoded)).toBe(MATCH_ORDER_DATA_HEX);

    const decoded = OrderData.decode(MATCH_ORDER_DATA_HEX);
    expect(decoded.udtValue).toBe(13n);
    expect(decoded.master.type).toBe("absolute");
    if (decoded.master.type !== "absolute") {
      throw new Error("Expected absolute master");
    }
    expect(decoded.master.value.txHash).toBe(byte32("07"));
    expect(decoded.master.value.index).toBe(11n);
    expect(decoded.info.ckbToUdt.ckbScale).toBe(5n);
    expect(decoded.info.ckbToUdt.udtScale).toBe(8n);
    expect(decoded.info.udtToCkb).toEqual(Ratio.empty());
    expect(decoded.info.ckbMinMatchLog).toBe(0);
  });
});

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
    }).toThrow("udtValue invalid, negative");
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
    }).toThrow("Ratio invalid");
    expect(() => {
      Info.from({
        ckbToUdt: Ratio.from({ ckbScale: 1n, udtScale: 0n }),
        udtToCkb: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
        ckbMinMatchLog: 0,
      }).validate();
    }).toThrow("Ratio invalid");
    expect(() => {
      Info.from({
        ckbToUdt: Ratio.from({ ckbScale: 1n, udtScale: 10n }),
        udtToCkb: Ratio.from({ ckbScale: 1n, udtScale: 1n }),
        ckbMinMatchLog: 0,
      }).validate();
    }).toThrow("allow order value to be extracted");
  });
});

describe("order entity wire bounds", () => {
  const maxUint64 = (1n << 64n) - 1n;

  it("accepts exactly encodable ratio and info bounds", () => {
    for (const ratio of [
      Ratio.empty(),
      Ratio.from({ ckbScale: maxUint64, udtScale: 1n }),
    ]) {
      expect(ratio.isValid()).toBe(true);
      expect(() => {
        ratio.toBytes();
      }).not.toThrow();
    }
    for (const ckbMinMatchLog of [0, 64]) {
      const info = Info.create(
        true,
        { ckbScale: maxUint64, udtScale: maxUint64 },
        ckbMinMatchLog,
      );
      expect(info.isValid()).toBe(true);
      expect(() => {
        info.toBytes();
      }).not.toThrow();
    }
  });

  it("rejects out-of-range ratio scales and nested ratios", () => {
    for (const [ratio, field] of [
      [Ratio.from({ ckbScale: -1n, udtScale: 1n }), "ckbScale"],
      [Ratio.from({ ckbScale: maxUint64 + 1n, udtScale: 1n }), "ckbScale"],
      [Ratio.from({ ckbScale: 1n, udtScale: -1n }), "udtScale"],
      [Ratio.from({ ckbScale: 1n, udtScale: maxUint64 + 1n }), "udtScale"],
    ] as const) {
      expect(ratio.isValid()).toBe(false);
      expect(() => {
        ratio.validate();
      }).toThrow("Ratio scale exceeds Uint64");
      expect(() => {
        ratio.toBytes();
      }).toThrow(`struct.${field} - NumLike out of uint64 bounds`);
    }
    expect(Info.create(true, { ckbScale: maxUint64 + 1n, udtScale: 1n }).isValid()).toBe(
      false,
    );
  });

  it("enforces the semantic Info integer range", () => {
    for (const ckbMinMatchLog of [-1, 65, 0.5, NaN]) {
      const info = Info.create(true, { ckbScale: 1n, udtScale: 1n }, ckbMinMatchLog);
      expect(info.isValid()).toBe(false);
      expect(() => {
        info.validate();
      }).toThrow("ckbMinMatchLog invalid");
    }
  });
});

describe("order data wire bounds", () => {
  const maxUint128 = (1n << 128n) - 1n;

  it("accepts and rejects exact Uint128 and Int32 boundaries", () => {
    const info = Info.create(true, { ckbScale: 1n, udtScale: 1n }, 0);
    for (const udtValue of [0n, maxUint128]) {
      const data = OrderData.from({
        udtValue,
        master: { type: "relative", value: Relative.create(1n) },
        info,
      });
      expect(data.isValid()).toBe(true);
      expect(() => {
        data.toBytes();
      }).not.toThrow();
    }
    for (const udtValue of [-1n, maxUint128 + 1n]) {
      const data = OrderData.from({
        udtValue,
        master: { type: "relative", value: Relative.create(1n) },
        info,
      });
      expect(data.isValid()).toBe(false);
      expect(() => {
        data.validate();
      }).toThrow(
        udtValue < 0n ? "udtValue invalid, negative" : "udtValue exceeds Uint128",
      );
      expect(() => {
        data.toBytes();
      }).toThrow("struct.udtValue - NumLike out of uint128 bounds");
    }
    for (const distance of [-(1n << 31n), (1n << 31n) - 1n]) {
      const relative = Relative.create(distance);
      expect(relative.isValid()).toBe(true);
      expect(() => {
        relative.toBytes();
      }).not.toThrow();
    }
    for (const distance of [-(1n << 31n) - 1n, 1n << 31n]) {
      const relative = Relative.create(distance);
      expect(relative.isValid()).toBe(false);
      expect(() => {
        relative.validate();
      }).toThrow("Relative master distance exceeds Int32");
      expect(() => {
        relative.toBytes();
      }).toThrow("struct.distance - NumLike out of int32 bounds");
    }
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
    const group = resolvedOrderGroup(order);

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
    expect(group.isOwner(group.master.cell.cellOutput.lock)).toBe(true);
    expect(group.isOwner(script("99"))).toBe(false);
  });

  it("reports malformed order data with its outpoint and codec cause", () => {
    const cell = orderCell({ ckbValue: 1000n, udtValue: 10n }).cell;
    cell.outputData = "0x";

    const error = catchError(() => OrderCell.mustFrom(cell));
    expect(error.message).toBe(`Invalid order payload at ${ORDER_OUT_POINT_HEX}`);
    expect(error.cause).toBeInstanceOf(Error);
    expect(OrderCell.tryFrom(cell)).toBeUndefined();
  });

  it("reports order validation failures with their outpoint and cause", () => {
    const cell = orderCell({ ckbValue: 1000n, udtValue: 10n }).cell;
    cell.outputData = ccc.hexFrom(
      OrderData.from({
        udtValue: 10n,
        master: {
          type: "absolute",
          value: { txHash: byte32("66"), index: 1n },
        },
        info: Info.from({
          ckbToUdt: Ratio.empty(),
          udtToCkb: Ratio.empty(),
          ckbMinMatchLog: 0,
        }),
      }).toBytes(),
    );

    const error = catchError(() => OrderCell.mustFrom(cell));
    expect(error.message).toBe(`Invalid order payload at ${ORDER_OUT_POINT_HEX}`);
    expect(error.cause).toBeInstanceOf(Error);
    const { cause } = error;
    if (!(cause instanceof Error)) {
      throw new Error("Expected validation error cause");
    }
    expect(cause.message).toBe("ckbToUdt is Empty, but udtToCkb is not Populated");
  });
});

describe("order descendant identity", () => {
  it("validates descendant identity invariants", () => {
    const origin = orderCell({
      ckbValue: ccc.fixedPointFrom(1000),
      udtValue: 10n,
      mint: true,
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
      mint: true,
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
      mint: true,
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
    expect(() => {
      wrongInfo.validate(origin);
    }).toThrow("Origin is not a mint order");
  });
});

describe("order descendant resolution", () => {
  it("resolves to the better descendant", () => {
    const origin = orderCell({
      ckbValue: ccc.fixedPointFrom(1000),
      udtValue: 10n,
      mint: true,
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
      mint: true,
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
  mint?: boolean;
  outPointIndex?: bigint;
}): OrderCell {
  const info = options.info ?? Info.create(true, { ckbScale: 1n, udtScale: 1n });
  const index = options.outPointIndex ?? 0n;
  const masterIndex = options.masterIndex ?? 1n;
  const cell = ccc.Cell.from({
    outPoint: { txHash: byte32(options.mint === true ? "66" : "55"), index },
    cellOutput: {
      capacity: options.ckbValue,
      lock: options.lock ?? ORDER_SCRIPT,
      type: options.udtScript ?? UDT_SCRIPT,
    },
    outputData: OrderData.from({
      udtValue: options.udtValue,
      master:
        options.mint === true
          ? { type: "relative", value: Relative.create(masterIndex - index) }
          : {
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

function catchError(callback: () => unknown): Error {
  try {
    callback();
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected callback to throw");
}
