import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { OrderMatcher } from "../../../src/order/matching/order_matcher.ts";
import { OrderCell, OrderGroup } from "../../../src/order/model/cells.ts";
import { Info } from "../../../src/order/model/info.ts";
import { Ratio } from "../../../src/order/model/ratio.ts";
import { OrderManager } from "../../../src/order/order.ts";
import { ORDER_MATCHER_SUITE } from "../fixtures/order_constants.ts";
import {
  cycle02ResidualGroups,
  exhaustiveIntegerBestMatch,
  makeUdtToCkbOrder,
  matchKey,
  resolvedOrderGroup,
  resolvedOrderGroups,
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
const EXPECTED_MATCHER_ERROR = "Expected order to be matchable";

describe(ORDER_MATCHER_SUITE, () => {
  registerOrderMatcherMinimumTests();
});

function registerOrderMatcherMinimumTests(): void {
  it("rejects UDT-to-CKB partials below the converted CKB minimum", () => {
    const order = makeUdtToCkbOrder();
    const matcher = OrderMatcher.from(resolvedOrderGroup(order), false, 0n);

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
    const matcher = OrderMatcher.from(resolvedOrderGroup(order), false, 0n);

    if (matcher === undefined) {
      throw new Error(EXPECTED_MATCHER_ERROR);
    }
    expect(matcher.bMaxMatch).toBeLessThan(1n << 33n);
    expect(matcher.bMinMatch).toBe(matcher.bMaxMatch);

    const match = matcher.match(matcher.bMaxMatch);

    expect(match.partials).toHaveLength(1);
    expect(match.partials[0]?.ckbOut).toBe(matcher.bMaxOut);
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
    expect(
      OrderManager.bestMatch(
        [],
        { ckbValue: 1n, udtValue: 1n },
        { ckbScale: 1n, udtScale: 1n },
      ),
    ).toEqual({
      kind: "complete",
      match: { ckbDelta: 0n, udtDelta: 0n, partials: [] },
    });
    expect(manager.melt(ccc.Transaction.default(), []).inputs).toEqual([]);
  });
});

describe("OrderManager match and melt transaction helpers", () => {
  registerMatchMeltSuccessTests();
  registerMintTransactionValidationTests();
  registerMatchInputValidationTests();
  registerMatchAccountingValidationTests();
  registerMatchPartialValidationTests();
  registerOrderGroupProvenanceTests();
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
    const group = resolvedOrderGroup(order);

    const matched = manager.addMatch(ccc.Transaction.default(), {
      ckbDelta: 0n,
      udtDelta: 0n,
      partials: [{ group, ckbOut: order.ckbValue, udtOut: order.udtValue }],
    });
    const melted = manager.melt(ccc.Transaction.default(), [group]);

    expect(matched.cellDeps).toHaveLength(1);
    expect(matched.inputs).toHaveLength(1);
    expect(matched.outputs).toHaveLength(1);
    expect(melted.inputs).toHaveLength(2);
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

function registerMatchInputValidationTests(): void {
  it("rejects a match order already present in transaction inputs", () => {
    const manager = new OrderManager(ORDER_SCRIPT, [], UDT_SCRIPT);
    const order = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(1000),
      udtValue: 10n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 1n }),
      master: { type: "absolute", value: { txHash: byte32FromByte("66"), index: 1n } },
      outPoint: { txHash: byte32FromByte("54"), index: 0n },
    });
    const tx = ccc.Transaction.default();
    tx.addInput(order.cell);
    const group = resolvedOrderGroup(order);

    expect(() =>
      manager.addMatch(tx, {
        ckbDelta: 0n,
        udtDelta: 0n,
        partials: [{ group, ckbOut: order.ckbValue, udtOut: order.udtValue }],
      }),
    ).toThrow(`Match order ${order.cell.outPoint.toHex()} is already being spent`);
  });
}

function registerMatchAccountingValidationTests(): void {
  it("rejects mismatched aggregate deltas without mutating the transaction", () => {
    const manager = new OrderManager(ORDER_SCRIPT, [], UDT_SCRIPT);
    const order = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(1000),
      udtValue: 10n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 1n }),
      master: { type: "absolute", value: { txHash: byte32FromByte("66"), index: 1n } },
      outPoint: { txHash: byte32FromByte("53"), index: 0n },
    });
    const tx = ccc.Transaction.default();
    const before = tx.toBytes();

    expect(() =>
      manager.addMatch(tx, {
        ckbDelta: 1n,
        udtDelta: 0n,
        partials: [
          {
            group: resolvedOrderGroup(order),
            ckbOut: order.ckbValue,
            udtOut: order.udtValue,
          },
        ],
      }),
    ).toThrow("Match deltas do not match partial order accounting");
    expect(tx.toBytes()).toEqual(before);
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
    const group = resolvedOrderGroup(order);
    const foreignGroup = resolvedOrderGroup(foreign);

    expect(() =>
      manager.addMatch(ccc.Transaction.default(), {
        ckbDelta: 0n,
        udtDelta: 0n,
        partials: [
          { group, ckbOut: order.ckbValue, udtOut: order.udtValue },
          { group, ckbOut: order.ckbValue, udtOut: order.udtValue },
        ],
      }),
    ).toThrow(`Match contains duplicate order cells: ${order.cell.outPoint.toHex()}`);
    expect(() =>
      manager.addMatch(ccc.Transaction.default(), {
        ckbDelta: 0n,
        udtDelta: 0n,
        partials: [
          { group: foreignGroup, ckbOut: foreign.ckbValue, udtOut: foreign.udtValue },
        ],
      }),
    ).toThrow(WRONG_MANAGER_ERROR);
    expect(() =>
      manager.addMatch(ccc.Transaction.default(), {
        ckbDelta: 0n,
        udtDelta: 0n,
        partials: [{ group, ckbOut: -1n, udtOut: order.udtValue }],
      }),
    ).toThrow("negative CKB output");
    expect(() =>
      manager.addMatch(ccc.Transaction.default(), {
        ckbDelta: 0n,
        udtDelta: 0n,
        partials: [{ group, ckbOut: order.ckbValue, udtOut: -1n }],
      }),
    ).toThrow("negative UDT output");
  });
}

function registerOrderGroupProvenanceTests(): void {
  it("rejects a fabricated origin at a resolved group's claimed outpoint", () => {
    const manager = new OrderManager(ORDER_SCRIPT, [], UDT_SCRIPT);
    const order = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(1000),
      udtValue: 10n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 1n }),
      master: { type: "absolute", value: { txHash: byte32FromByte("66"), index: 1n } },
      outPoint: { txHash: byte32FromByte("57"), index: 0n },
    });
    const group = resolvedOrderGroup(order);
    const fabricatedOrigin = OrderCell.mustFrom(
      ccc.Cell.from({
        outPoint: group.origin.cell.outPoint,
        cellOutput: group.origin.cell.cellOutput,
        outputData: group.origin.cell.outputData,
      }),
    );
    const fabricatedGroup = new OrderGroup(group.master, group.order, fabricatedOrigin);

    expect(() =>
      manager.addMatch(ccc.Transaction.default(), {
        ckbDelta: 0n,
        udtDelta: 0n,
        partials: [
          { group: fabricatedGroup, ckbOut: order.ckbValue, udtOut: order.udtValue },
        ],
      }),
    ).toThrow("OrderGroup does not match its resolver attestation");
  });
}

function registerMeltGroupValidationTests(): void {
  it("builds the transaction of a best match from the resolver's groups", () => {
    const manager = new OrderManager(ORDER_SCRIPT, [], UDT_SCRIPT);
    const order = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(1000),
      udtValue: 0n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 1n }, 0),
      master: { type: "absolute", value: { txHash: byte32FromByte("77"), index: 1n } },
      outPoint: { txHash: byte32FromByte("5b"), index: 0n },
    });
    const group = resolvedOrderGroup(order);
    // The order pays one CKB per iCKB while the rate values CKB double, so the bot gains.
    const result = OrderManager.bestMatch(
      [group],
      { ckbValue: 0n, udtValue: ccc.fixedPointFrom(1000) },
      { ckbScale: 2n, udtScale: 1n },
    );

    expect(result.match.partials).toHaveLength(1);
    expect(manager.addMatch(ccc.Transaction.default(), result.match).inputs).toHaveLength(
      1,
    );
  });

  it("rejects melt groups from a different manager", () => {
    const manager = new OrderManager(ORDER_SCRIPT, [], UDT_SCRIPT);
    const foreignOrder = makeOrderCell({
      ckbUnoccupied: ccc.fixedPointFrom(1000),
      udtValue: 0n,
      info: Info.create(true, { ckbScale: 1n, udtScale: 1n }),
      lock: script("99"),
      master: { type: "absolute", value: { txHash: byte32FromByte("66"), index: 1n } },
      outPoint: { txHash: byte32FromByte("58"), index: 0n },
    });
    const foreignOrderGroup = resolvedOrderGroup(foreignOrder);

    expect(() => manager.melt(ccc.Transaction.default(), [foreignOrderGroup])).toThrow(
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
    const group = resolvedOrderGroup(order);
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
      new OrderMatcher(resolvedOrderGroup(order), true, {
        aScale: 1n,
        bScale: 1n,
        aIn: -1n,
        bIn: 0n,
        aMin: 0n,
        bMinMatch: 0n,
        bMaxMatch: 0n,
        bMaxOut: 0n,
        realRatioNumerator: 1n,
        realRatioDenominator: 1n,
      });

    expect(constructMatcher).toThrow("OrderMatcher aIn must be non-negative");
  });
}

describe(ORDER_MATCHER_SUITE, () => {
  it("matches an exhaustive cross-product on a bounded pool", () => {
    const orders = [
      makeOrderCell({
        ckbUnoccupied: 9n,
        udtValue: 4n,
        info: dualInfo(),
        master: {
          type: "absolute",
          value: { txHash: byte32FromByte("33"), index: 1n },
        },
        outPoint: { txHash: byte32FromByte("47"), index: 0n },
      }),
      makeOrderCell({
        ckbUnoccupied: 6n,
        udtValue: 8n,
        info: dualInfo(),
        master: {
          type: "absolute",
          value: { txHash: byte32FromByte("34"), index: 1n },
        },
        outPoint: { txHash: byte32FromByte("48"), index: 0n },
      }),
      makeOrderCell({
        ckbUnoccupied: 3n,
        udtValue: 12n,
        info: dualInfo(),
        master: {
          type: "absolute",
          value: { txHash: byte32FromByte("35"), index: 1n },
        },
        outPoint: { txHash: byte32FromByte("49"), index: 0n },
      }),
    ];
    const allowance = {
      ckbValue: 16n,
      udtValue: 12n,
    };
    const exchangeRate = { ckbScale: 1n, udtScale: 1n };
    const options = {
      feeRate: 0n,
      maxPartials: 3,
    };

    const groups = resolvedOrderGroups(orders);
    expect(
      matchKey(OrderManager.bestMatch(groups, allowance, exchangeRate, options).match),
    ).toEqual(
      matchKey(exhaustiveIntegerBestMatch(groups, allowance, exchangeRate, options)),
    );
  });
});

describe(ORDER_MATCHER_SUITE, () => {
  it("returns the best feasible match seen with its gap when the node budget ends the search", () => {
    const specs = [
      [119n, 210n, 2n, 13n],
      [13n, 2n, 6n, 1n],
      [147n, 152n, 10n, 5n],
      [123n, 130n, 14n, 9n],
      [217n, 116n, 2n, 13n],
    ] as const;
    const masterIds = ["70", "71", "72", "73", "74"] as const;
    const orderIds = ["80", "81", "82", "83", "84"] as const;
    const orders = specs.map(([ckbUnoccupied, udtValue, ckbScale, udtScale], index) => {
      const ratio = Ratio.from({ ckbScale, udtScale });
      return makeOrderCell({
        ckbUnoccupied,
        udtValue,
        info: Info.from({
          ckbToUdt: ratio,
          udtToCkb: ratio,
          ckbMinMatchLog: 0,
        }),
        master: {
          type: "absolute",
          value: { txHash: byte32FromByte(masterIds[index] ?? "70"), index: 1n },
        },
        outPoint: {
          txHash: byte32FromByte(orderIds[index] ?? "80"),
          index: 0n,
        },
      });
    });
    const groups = resolvedOrderGroups(orders);
    const allowance = { ckbValue: 181n, udtValue: 0n };
    const exchangeRate = { ckbScale: 16n, udtScale: 3n };
    const options = { feeRate: 0n, maxPartials: 5, candidateBudget: 3 };

    const result = OrderManager.bestMatch(groups, allowance, exchangeRate, options);

    expect(result).toMatchObject({ kind: "incomplete", budget: 3 });
    if (result.kind !== "incomplete") {
      throw new Error("Expected an incomplete search");
    }
    expect(result.gap).toBeGreaterThanOrEqual(0n);
    expect(allowance.ckbValue + result.match.ckbDelta).toBeGreaterThanOrEqual(0n);
    expect(allowance.udtValue + result.match.udtDelta).toBeGreaterThanOrEqual(0n);
    expect(result.match.diagnostics?.gainUpperBound).toBe(
      (result.match.diagnostics?.bestGain ?? 0n) + result.gap,
    );
  });
});

describe(`${ORDER_MATCHER_SUITE} residual budgets`, () => {
  it("closes the leftover balances with a partial fill the allowance can pay", () => {
    const groups = cycle02ResidualGroups();
    const allowance = { ckbValue: 11n, udtValue: 82n };
    const exchangeRate = { ckbScale: 2n, udtScale: 5n };

    const { match } = OrderManager.bestMatch(groups, allowance, exchangeRate, {
      feeRate: 0n,
      maxPartials: 3,
    });

    expect(match.partials.length).toBeGreaterThanOrEqual(1);
    expect(match.ckbDelta * 2n + match.udtDelta * 5n).toBeGreaterThan(0n);
    expect(allowance.ckbValue + match.ckbDelta).toBeGreaterThanOrEqual(0n);
    expect(allowance.udtValue + match.udtDelta).toBeGreaterThanOrEqual(0n);
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
