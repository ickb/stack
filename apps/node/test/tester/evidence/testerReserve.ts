import { ccc } from "@ckb-ccc/core";
import { byte32FromByte, capacityCell, script } from "@ickb/testkit";
import { describe, expect, it } from "vitest";
import {
  enforceTesterPlainCkbReserve,
  postTransactionPlainCkbBalance,
  testerReserveSkip,
} from "../../../src/tester/evidence/testerReserve.ts";
import { TesterTerminalError } from "../../../src/tester/runtime/testerTypes.ts";
import {
  ALL_CKB_LIMIT_ORDER_SCENARIO,
  ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
  PLAN_TESTER_TRANSACTION,
  POST_TX_CKB_RESERVE_REASON,
  testerState,
} from "../support/tester/index.ts";

describe(`${PLAN_TESTER_TRANSACTION} reserve accounting`, () => {
  it("computes post-transaction plain CKB reserve from unspent inputs and account outputs", () => {
    const lock = script("11");
    const otherLock = script("22");
    const spent = capacityCell(ccc.fixedPointFrom(1000), lock, "01");
    const unspent = capacityCell(ccc.fixedPointFrom(2000), lock, "02");
    const typed = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("03"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(4000),
        lock,
        type: script("33"),
      },
      outputData: "0x",
    });
    const data = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("04"), index: 0n },
      cellOutput: { capacity: ccc.fixedPointFrom(8000), lock },
      outputData: "0x1234",
    });
    const tx = ccc.Transaction.default();
    tx.inputs.push(ccc.CellInput.from({ previousOutput: spent.outPoint }));
    tx.addOutput({ capacity: ccc.fixedPointFrom(300), lock });
    tx.addOutput({
      capacity: ccc.fixedPointFrom(500),
      lock,
      type: script("33"),
    });
    tx.addOutput({ capacity: ccc.fixedPointFrom(700), lock: otherLock });
    tx.addOutput({ capacity: ccc.fixedPointFrom(900), lock }, "0x1234");

    expect(
      postTransactionPlainCkbBalance(
        tx,
        testerState({
          availableCkbBalance: ccc.fixedPointFrom(3000),
          capacityCells: [spent, unspent, typed, data],
        }),
        [lock],
      ),
    ).toBe(ccc.fixedPointFrom(2300));
  });

  it("formats post-transaction reserve skip details", () => {
    expect(
      testerReserveSkip(ccc.fixedPointFrom(1000), ccc.fixedPointFrom(3000)),
    ).toBeUndefined();
    expect(testerReserveSkip(0n, ccc.fixedPointFrom(1000))).toEqual({
      reason: POST_TX_CKB_RESERVE_REASON,
      reserve: "1000",
      preTxCkbBalance: "1000",
      postTxCkbBalance: "0",
      deficit: "1000",
    });
  });
});
describe(`${PLAN_TESTER_TRANSACTION} reserve enforcement`, () => {
  it("checks the post-transaction CKB reserve for iCKB-to-CKB transactions", () => {
    const lock = script("11");
    const spent = capacityCell(ccc.fixedPointFrom(1000), lock, "05");
    const tx = ccc.Transaction.default();
    tx.inputs.push(ccc.CellInput.from({ previousOutput: spent.outPoint }));
    tx.addOutput({ capacity: ccc.fixedPointFrom(100), lock });

    expect(
      enforceTesterPlainCkbReserve(
        tx,
        testerState({
          availableCkbBalance: ccc.fixedPointFrom(1000),
          capacityCells: [spent],
        }),
        [lock],
        ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
      ),
    ).toEqual({
      reason: POST_TX_CKB_RESERVE_REASON,
      reserve: "1000",
      preTxCkbBalance: "1000",
      postTxCkbBalance: "100",
      deficit: "900",
    });
  });

  it("allows below-reserve transactions that improve plain CKB", () => {
    const lock = script("11");
    const tx = ccc.Transaction.default();
    tx.addOutput({ capacity: ccc.fixedPointFrom(100), lock });

    expect(
      enforceTesterPlainCkbReserve(
        tx,
        testerState({ availableCkbBalance: 0n }),
        [lock],
        ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
      ),
    ).toBeUndefined();
  });
});
describe(`${PLAN_TESTER_TRANSACTION} reserve enforcement`, () => {
  it("allows below-reserve transactions that preserve plain CKB", () => {
    const lock = script("11");
    const spent = capacityCell(ccc.fixedPointFrom(1000), lock, "06");
    const tx = ccc.Transaction.default();
    tx.inputs.push(ccc.CellInput.from({ previousOutput: spent.outPoint }));
    tx.addOutput({ capacity: ccc.fixedPointFrom(1000), lock });

    expect(
      enforceTesterPlainCkbReserve(
        tx,
        testerState({
          availableCkbBalance: ccc.fixedPointFrom(1000),
          capacityCells: [spent],
        }),
        [lock],
        ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
      ),
    ).toBeUndefined();
  });

  it("still blocks below-reserve transactions that drain plain CKB", () => {
    const lock = script("11");
    const spent = capacityCell(ccc.fixedPointFrom(1000), lock, "07");
    const tx = ccc.Transaction.default();
    tx.inputs.push(ccc.CellInput.from({ previousOutput: spent.outPoint }));
    tx.addOutput({ capacity: ccc.fixedPointFrom(999), lock });

    expect(
      enforceTesterPlainCkbReserve(
        tx,
        testerState({
          availableCkbBalance: ccc.fixedPointFrom(1000),
          capacityCells: [spent],
        }),
        [lock],
        ICKB_TO_CKB_LIMIT_ORDER_SCENARIO,
      ),
    ).toEqual({
      reason: POST_TX_CKB_RESERVE_REASON,
      reserve: "1000",
      preTxCkbBalance: "1000",
      postTxCkbBalance: "999",
      deficit: "1",
    });
  });
});
describe(`${PLAN_TESTER_TRANSACTION} explicit reserve stress`, () => {
  it("fails explicit CKB reserve stress scenarios when completed transactions violate reserve", () => {
    const lock = script("11");
    const spent = capacityCell(ccc.fixedPointFrom(2000), lock, "08");
    const tx = ccc.Transaction.default();
    tx.inputs.push(ccc.CellInput.from({ previousOutput: spent.outPoint }));
    tx.addOutput({ capacity: ccc.fixedPointFrom(999), lock });

    expect(() =>
      enforceTesterPlainCkbReserve(
        tx,
        testerState({
          availableCkbBalance: ccc.fixedPointFrom(2000),
          capacityCells: [spent],
        }),
        [lock],
        ALL_CKB_LIMIT_ORDER_SCENARIO,
      ),
    ).toThrow(TesterTerminalError);
  });

  it("allows explicit CKB reserve stress scenarios that preserve the exact reserve", () => {
    const lock = script("11");
    const spent = capacityCell(ccc.fixedPointFrom(2000), lock, "10");
    const tx = ccc.Transaction.default();
    tx.inputs.push(ccc.CellInput.from({ previousOutput: spent.outPoint }));
    tx.addOutput({ capacity: ccc.fixedPointFrom(1000), lock });

    expect(
      enforceTesterPlainCkbReserve(
        tx,
        testerState({
          availableCkbBalance: ccc.fixedPointFrom(2000),
          capacityCells: [spent],
        }),
        [lock],
        ALL_CKB_LIMIT_ORDER_SCENARIO,
      ),
    ).toBeUndefined();
  });

  it("fails explicit CKB reserve stress scenarios that preserve an existing reserve deficit", () => {
    const lock = script("11");
    const spent = capacityCell(ccc.fixedPointFrom(999), lock, "09");
    const tx = ccc.Transaction.default();
    tx.inputs.push(ccc.CellInput.from({ previousOutput: spent.outPoint }));
    tx.addOutput({ capacity: ccc.fixedPointFrom(999), lock });

    expect(() =>
      enforceTesterPlainCkbReserve(
        tx,
        testerState({
          availableCkbBalance: ccc.fixedPointFrom(999),
          capacityCells: [spent],
        }),
        [lock],
        ALL_CKB_LIMIT_ORDER_SCENARIO,
      ),
    ).toThrow(TesterTerminalError);
  });
});
