import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { IckbUdt } from "../../../src/core/udt.ts";
import { DaoManager } from "../../../src/dao/index.ts";
import {
  byte32FromByte,
  RECEIPT_PREFIX_DECODING_SUITE,
  receiptCell,
  receiptOutputData,
  script,
  xudtCell,
} from "../cells/support/cells_support.ts";

describe(RECEIPT_PREFIX_DECODING_SUITE, () => {
  registerUdtCellDepTests();
  registerUdtDetectionTests();
});

function registerUdtCellDepTests(): void {
  it("adds xUDT and logic code deps explicitly", () => {
    const { ickbUdt, logicCode, xudtCode } = testIckbUdt();

    const tx = ickbUdt.addCellDeps(ccc.Transaction.default());

    expect(tx.cellDeps).toHaveLength(2);
    expect(tx.cellDeps[0]?.depType).toBe("code");
    expect(tx.cellDeps[0]?.outPoint.eq(ccc.OutPoint.from(xudtCode))).toBe(true);
    expect(tx.cellDeps[1]?.depType).toBe("code");
    expect(tx.cellDeps[1]?.outPoint.eq(ccc.OutPoint.from(logicCode))).toBe(true);
  });

  it("does not duplicate xUDT and logic code deps", () => {
    const { ickbUdt } = testIckbUdt();

    const tx = ickbUdt.addCellDeps(ickbUdt.addCellDeps(ccc.Transaction.default()));

    expect(tx.cellDeps).toHaveLength(2);
  });
}

function registerUdtDetectionTests(): void {
  it("identifies only xUDT cells with UDT data", () => {
    const { ickbUdt, logic, type } = testIckbUdt();

    expect(ickbUdt.isUdt(xudtCell(1n, type))).toBe(true);
    expect(ickbUdt.isUdt(receiptCell(receiptOutputData(1, 1n), logic))).toBe(false);
    expect(
      ickbUdt.isUdt(
        ccc.Cell.from({
          outPoint: { txHash: byte32FromByte("aa"), index: 0n },
          cellOutput: { capacity: ccc.fixedPointFrom(100), lock: script("22"), type },
          outputData: "0x",
        }),
      ),
    ).toBe(false);
  });
}

function testIckbUdt(): {
  ickbUdt: IckbUdt;
  logic: ccc.Script;
  logicCode: ccc.OutPointLike;
  type: ccc.Script;
  xudtCode: ccc.OutPointLike;
} {
  const logic = script("33");
  const type = script("55");
  const xudtCode = { txHash: byte32FromByte("44"), index: 1n };
  const logicCode = { txHash: byte32FromByte("66"), index: 2n };
  return {
    ickbUdt: new IckbUdt({
      code: xudtCode,
      script: type,
      logicCode,
      logicScript: logic,
      daoManager: new DaoManager(script("77"), []),
    }),
    logic,
    logicCode,
    type,
    xudtCode,
  };
}
