import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { MasterCell, OrderCell, OrderGroup } from "../../src/model/cells.ts";
import { Info } from "../../src/model/info.ts";
import { OrderData } from "../../src/model/order_data.ts";
import { Ratio } from "../../src/model/ratio.ts";
import { OrderManager, OrderMatcher } from "../../src/order.ts";
import { ORDER_MATCHER_SUITE } from "../fixtures/order_constants.ts";
import {
  exhaustiveSequentialBestMatch,
  makeUdtToCkbOrder,
  matchKey,
} from "./support/order_match_helpers.ts";
import {
  byte32FromByte,
  dualInfo,
  makeOrderCell,
} from "./support/order_order_helpers.ts";

const ORDER_SCRIPT = script("11");
const UDT_SCRIPT = script("22");
const OWNER_LOCK = script("33");
const WRONG_MANAGER_ERROR = "does not match this order manager";

describe(ORDER_MATCHER_SUITE, () => {
  registerOrderMatcherMinimumTests();
  registerSequentialMatcherTests();
});

function registerOrderMatcherMinimumTests(): void {
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

  it("allows full consumption when the remaining CKB match is below the default minimum", () => {
    const order = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(50),
      udtValue: ccc.fixedPointFrom(50),
      info: Info.create(false, { ckbScale: 1n, udtScale: 1n }),
      master: {
        type: "absolute",
        value: {
          txHash: byte32FromByte("33"),
          index: 1n,
        },
      },
      outPoint: {
        txHash: byte32FromByte("45"),
        index: 0n,
      },
    });
    const matcher = OrderMatcher.from(order, false, 0n);

    if (matcher === undefined) {
      throw new Error("Expected order to be matchable");
    }
    expect(matcher.bMaxMatch).toBeLessThan(1n << 33n);
    expect(matcher.bMinMatch).toBe(matcher.bMaxMatch);

    const match = matcher.match(matcher.bMaxMatch);

    expect(match.partials).toHaveLength(1);
    expect(match.partials[0]?.ckbOut).toBe(matcher.bMaxOut);
  });
}

function registerSequentialMatcherTests(): void {
  it("continues trying larger allowances after an allowance below the minimum", () => {
    const order = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(200),
      udtValue: 0n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 1n }),
      master: {
        type: "absolute",
        value: {
          txHash: byte32FromByte("33"),
          index: 1n,
        },
      },
      outPoint: {
        txHash: byte32FromByte("46"),
        index: 0n,
      },
    });
    const matcher = OrderMatcher.from(order, true, 0n);

    if (matcher === undefined) {
      throw new Error("Expected order to be matchable");
    }
    expect(ccc.fixedPointFrom(50)).toBeLessThan(matcher.bMinMatch);

    const matches = Array.from(
      OrderManager.sequentialMatcher([order], true, ccc.fixedPointFrom(50), 0n),
    );

    expect(matches.find((match) => match.partials.length === 1)?.partials).toHaveLength(
      1,
    );
  });

  it("rejects a zero sequential allowance step", () => {
    const order = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(200),
      udtValue: 0n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 1n }),
      master: {
        type: "absolute",
        value: {
          txHash: byte32FromByte("33"),
          index: 1n,
        },
      },
      outPoint: {
        txHash: byte32FromByte("47"),
        index: 0n,
      },
    });

    expect(() =>
      Array.from(OrderManager.sequentialMatcher([order], true, 0n, 0n)),
    ).toThrow("Allowance step must be positive");
  });
}

describe("OrderManager no-op transaction helpers", () => {
  it("recognizes master cells and handles no-op matches and melts", () => {
    const manager = new OrderManager(ORDER_SCRIPT, [], UDT_SCRIPT);
    const master = masterCell();
    const order = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(1000),
      udtValue: 10n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 1n }),
      master: { type: "absolute", value: { txHash: byte32FromByte("66"), index: 1n } },
      outPoint: { txHash: byte32FromByte("55"), index: 0n },
    });

    expect(manager.isMaster(master)).toBe(true);
    expect(manager.isMaster(order.cell)).toBe(false);
    expect(
      manager.addMatch(ccc.Transaction.default(), {
        ckbDelta: 0n,
        udtDelta: 0n,
        partials: [],
      }).inputs,
    ).toEqual([]);
    expect(manager.match(order, false, 0n)).toEqual({
      ckbDelta: 0n,
      udtDelta: 0n,
      partials: [],
    });
    expect(
      OrderManager.bestMatch(
        [],
        { ckbValue: 1n, udtValue: 1n },
        { ckbScale: 1n, udtScale: 1n },
      ),
    ).toEqual({ ckbDelta: 0n, udtDelta: 0n, partials: [] });
    expect(
      manager.melt(ccc.Transaction.default(), [], { isFulfilledOnly: true }).inputs,
    ).toEqual([]);
  });
});

describe("OrderManager match and melt transaction helpers", () => {
  registerMatchMeltSuccessTests();
  registerMintTransactionValidationTests();
  registerMatchPartialValidationTests();
  registerMeltGroupValidationTests();
  registerMatcherConstructorValidationTests();
});

function registerMatchMeltSuccessTests(): void {
  it("adds match partials and melt inputs for selected groups", () => {
    const manager = new OrderManager(
      ORDER_SCRIPT,
      [
        ccc.CellDep.from({
          outPoint: { txHash: byte32FromByte("aa"), index: 0n },
          depType: "code",
        }),
      ],
      UDT_SCRIPT,
    );
    const order = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(1000),
      udtValue: 10n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 1n }),
      master: { type: "absolute", value: { txHash: byte32FromByte("66"), index: 1n } },
      outPoint: { txHash: byte32FromByte("55"), index: 0n },
    });
    const master = MasterCell.from(masterCell());
    const group = new OrderGroup(master, order, order);

    const matched = manager.addMatch(ccc.Transaction.default(), {
      ckbDelta: 1n,
      udtDelta: -1n,
      partials: [{ order, ckbOut: order.ckbValue, udtOut: order.udtValue }],
    });
    const melted = manager.melt(ccc.Transaction.default(), [group]);
    const fulfilledOnly = manager.melt(ccc.Transaction.default(), [group], {
      isFulfilledOnly: true,
    });

    expect(matched.cellDeps).toHaveLength(1);
    expect(matched.inputs).toHaveLength(1);
    expect(matched.outputs).toHaveLength(1);
    expect(melted.inputs).toHaveLength(2);
    expect(fulfilledOnly.inputs).toEqual([]);
  });
}

function registerMintTransactionValidationTests(): void {
  it("fails closed if mint output append cannot be observed", () => {
    const manager = new OrderManager(ORDER_SCRIPT, [], UDT_SCRIPT);

    expect(() => {
      manager.mint(
        new UnobservableOutputTransaction(),
        OWNER_LOCK,
        Info.create(true, { ckbScale: 1n, udtScale: 1n }),
        {
          ckbValue: 1n,
          udtValue: 1n,
        },
      );
    }).toThrow("Failed to append order output");
  });

  it("rejects invalid mint data before adding order outputs", () => {
    const manager = new OrderManager(ORDER_SCRIPT, [], UDT_SCRIPT);
    const info = Info.create(true, { ckbScale: 1n, udtScale: 1n });

    expect(() =>
      manager.mint(ccc.Transaction.default(), OWNER_LOCK, info, {
        ckbValue: -1n,
        udtValue: 1n,
      }),
    ).toThrow("ckbValue invalid, negative");
    expect(() =>
      manager.mint(ccc.Transaction.default(), OWNER_LOCK, info, {
        ckbValue: 1n,
        udtValue: -1n,
      }),
    ).toThrow("udtValue invalid, negative");
    expect(() =>
      manager.mint(
        ccc.Transaction.default(),
        OWNER_LOCK,
        Info.from({
          ckbToUdt: Ratio.empty(),
          udtToCkb: Ratio.empty(),
          ckbMinMatchLog: 0,
        }),
        { ckbValue: 1n, udtValue: 1n },
      ),
    ).toThrow("ckbToUdt is Empty, but udtToCkb is not Populated");
  });
}

function registerMatchPartialValidationTests(): void {
  it("rejects fabricated match partials", () => {
    const manager = new OrderManager(ORDER_SCRIPT, [], UDT_SCRIPT);
    const order = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(1000),
      udtValue: 10n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 1n }),
      master: { type: "absolute", value: { txHash: byte32FromByte("66"), index: 1n } },
      outPoint: { txHash: byte32FromByte("55"), index: 0n },
    });
    const foreign = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(1000),
      udtValue: 10n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 1n }),
      lock: script("99"),
      master: { type: "absolute", value: { txHash: byte32FromByte("66"), index: 1n } },
      outPoint: { txHash: byte32FromByte("56"), index: 0n },
    });
    const mismatched = new OrderCell(
      order.cell,
      OrderData.from({
        udtValue: 11n,
        master: { type: "absolute", value: { txHash: byte32FromByte("66"), index: 1n } },
        info: order.data.info,
      }),
      order.ckbUnoccupied,
      order.absTotal,
      order.absProgress,
      order.maturity,
    );

    expect(() =>
      manager.addMatch(ccc.Transaction.default(), {
        ckbDelta: 0n,
        udtDelta: 0n,
        partials: [
          { order, ckbOut: order.ckbValue, udtOut: order.udtValue },
          { order, ckbOut: order.ckbValue, udtOut: order.udtValue },
        ],
      }),
    ).toThrow(`Match contains duplicate order cells: ${order.cell.outPoint.toHex()}`);
    expect(() =>
      manager.addMatch(ccc.Transaction.default(), {
        ckbDelta: 0n,
        udtDelta: 0n,
        partials: [
          { order: foreign, ckbOut: foreign.ckbValue, udtOut: foreign.udtValue },
        ],
      }),
    ).toThrow(WRONG_MANAGER_ERROR);
    expect(() =>
      manager.addMatch(ccc.Transaction.default(), {
        ckbDelta: 0n,
        udtDelta: 0n,
        partials: [{ order, ckbOut: -1n, udtOut: order.udtValue }],
      }),
    ).toThrow("negative CKB output");
    expect(() =>
      manager.addMatch(ccc.Transaction.default(), {
        ckbDelta: 0n,
        udtDelta: 0n,
        partials: [{ order, ckbOut: order.ckbValue, udtOut: -1n }],
      }),
    ).toThrow("negative UDT output");
    expect(() =>
      manager.addMatch(ccc.Transaction.default(), {
        ckbDelta: 0n,
        udtDelta: 0n,
        partials: [{ order: mismatched, ckbOut: order.ckbValue, udtOut: order.udtValue }],
      }),
    ).toThrow("does not match its cell data");
  });
}

function registerMeltGroupValidationTests(): void {
  it("rejects melt groups from a different manager", () => {
    const manager = new OrderManager(ORDER_SCRIPT, [], UDT_SCRIPT);
    const order = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(1000),
      udtValue: 0n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 1n }),
      master: { type: "absolute", value: { txHash: byte32FromByte("66"), index: 1n } },
      outPoint: { txHash: byte32FromByte("57"), index: 0n },
    });
    const foreignOrder = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(1000),
      udtValue: 0n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 1n }),
      lock: script("99"),
      master: { type: "absolute", value: { txHash: byte32FromByte("66"), index: 1n } },
      outPoint: { txHash: byte32FromByte("58"), index: 0n },
    });
    const master = MasterCell.from(masterCell());
    const foreignMaster = MasterCell.from(
      ccc.Cell.from({
        outPoint: { txHash: byte32FromByte("66"), index: 1n },
        cellOutput: { capacity: 61n, lock: OWNER_LOCK, type: script("99") },
        outputData: "0x",
      }),
    );
    const group = new OrderGroup(foreignMaster, order, order);

    expect(() =>
      manager.melt(ccc.Transaction.default(), [
        new OrderGroup(master, foreignOrder, foreignOrder),
      ]),
    ).toThrow(WRONG_MANAGER_ERROR);
    expect(() => manager.melt(ccc.Transaction.default(), [group])).toThrow(
      WRONG_MANAGER_ERROR,
    );
  });

  it("rejects duplicated or already-spent melt inputs", () => {
    const manager = new OrderManager(ORDER_SCRIPT, [], UDT_SCRIPT);
    const order = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(1000),
      udtValue: 0n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 1n }),
      master: { type: "absolute", value: { txHash: byte32FromByte("66"), index: 1n } },
      outPoint: { txHash: byte32FromByte("5a"), index: 0n },
    });
    const master = MasterCell.from(masterCell());
    const group = new OrderGroup(master, order, order);
    const tx = ccc.Transaction.default();
    tx.addInput(order.cell);

    expect(() => manager.melt(ccc.Transaction.default(), [group, group])).toThrow(
      `Melt order ${order.cell.outPoint.toHex()} is duplicated`,
    );
    expect(() => manager.melt(tx, [group])).toThrow(
      `Melt order ${order.cell.outPoint.toHex()} is already being spent`,
    );
  });
}

function registerMatcherConstructorValidationTests(): void {
  it("rejects negative order matcher constructor values", () => {
    const order = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(1000),
      udtValue: 0n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 1n }),
      master: { type: "absolute", value: { txHash: byte32FromByte("66"), index: 1n } },
      outPoint: { txHash: byte32FromByte("59"), index: 0n },
    });
    const constructMatcher = (): OrderMatcher =>
      new OrderMatcher(order, true, 1n, 1n, -1n, 0n, 0n, 0n, 0n, 0n, 1n, 1n);

    expect(constructMatcher).toThrow("OrderMatcher aIn must be non-negative");
  });
}

describe(ORDER_MATCHER_SUITE, () => {
  it("matches an exhaustive cross-product on a bounded pool", () => {
    const orders = [
      makeOrderCell({
        ckbUnoccupied: ccc.fixedPointFrom(90),
        udtValue: ccc.fixedPointFrom(40),
        info: dualInfo(),
        master: {
          type: "absolute",
          value: { txHash: byte32FromByte("33"), index: 1n },
        },
        outPoint: { txHash: byte32FromByte("47"), index: 0n },
      }),
      makeOrderCell({
        ckbUnoccupied: ccc.fixedPointFrom(60),
        udtValue: ccc.fixedPointFrom(80),
        info: dualInfo(),
        master: {
          type: "absolute",
          value: { txHash: byte32FromByte("34"), index: 1n },
        },
        outPoint: { txHash: byte32FromByte("48"), index: 0n },
      }),
      makeOrderCell({
        ckbUnoccupied: ccc.fixedPointFrom(30),
        udtValue: ccc.fixedPointFrom(120),
        info: dualInfo(),
        master: {
          type: "absolute",
          value: { txHash: byte32FromByte("35"), index: 1n },
        },
        outPoint: { txHash: byte32FromByte("49"), index: 0n },
      }),
    ];
    const allowance = {
      ckbValue: ccc.fixedPointFrom(160),
      udtValue: ccc.fixedPointFrom(120),
    };
    const exchangeRate = { ckbScale: 1n, udtScale: 1n };
    const options = {
      feeRate: 0n,
      ckbAllowanceStep: ccc.fixedPointFrom(50),
      maxPartials: 3,
    };

    expect(
      matchKey(OrderManager.bestMatch(orders, allowance, exchangeRate, options)),
    ).toEqual(
      matchKey(exhaustiveSequentialBestMatch(orders, allowance, exchangeRate, options)),
    );
  });
});

function masterCell(): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte("66"), index: 1n },
    cellOutput: { capacity: 61n, lock: OWNER_LOCK, type: ORDER_SCRIPT },
    outputData: "0x",
  });
}

function script(byte: string): ccc.Script {
  return ccc.Script.from({
    codeHash: byte32FromByte(byte),
    hashType: "type",
    args: "0x",
  });
}

class UnobservableOutputTransaction extends ccc.Transaction {
  constructor() {
    super(0n, [], [], [], [], [], []);
  }

  public override addOutput(_cellLike: ccc.CellAnyLike): number;
  public override addOutput(
    _outputLike: ccc.CellOutputLike,
    _outputDataLike?: ccc.BytesLike | null,
  ): number;
  public override addOutput(): number {
    return 0;
  }
}
