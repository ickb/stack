import { ccc } from "@ckb-ccc/core";
import { DaoManager } from "@ickb/dao";
import { describe, expect, it } from "vitest";
import { IckbUdt } from "../../src/udt.ts";
import {
  byte32FromByte,
  clientWithHeader,
  headerLike,
  RECEIPT_PREFIX_DECODING_SUITE,
  receiptCell,
  receiptOutputData,
  script,
  signerWithCells,
  StubClient,
  xudtCell,
} from "../cells/support/cells_support.ts";

describe(RECEIPT_PREFIX_DECODING_SUITE, () => {
  registerUdtCellDepTests();
  registerUdtDetectionTests();
  registerCompleteByHeaderErrorTests();
  registerOverfundingTests();
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

function registerCompleteByHeaderErrorTests(): void {
  it("completeBy throws when receipt header is missing", async () => {
    const { ickbUdt, logic } = testIckbUdt();
    const tx = ccc.Transaction.default();
    const receipt = receiptCell(receiptOutputData(1, 40n), logic);
    tx.addInput(receipt);
    const signer = signerWithCells(
      [],
      new StubClient({
        getTransactionWithHeader: async (): ReturnType<
          ccc.Client["getTransactionWithHeader"]
        > => {
          await Promise.resolve();
          return undefined;
        },
      }),
    );

    await expect(ickbUdt.completeBy(tx, signer)).rejects.toThrow(
      `Header not found for txHash ${receipt.outPoint.txHash} at ${receipt.outPoint.toHex()}`,
    );
  });
}

function registerOverfundingTests(): void {
  it("completeBy collects a second xUDT input when the first overfunds", async () => {
    const { ickbUdt, type } = testIckbUdt();
    const tx = ccc.Transaction.from({
      outputs: [{ lock: script("22"), type }],
      outputsData: [ccc.numLeToBytes(100n, 16)],
    });
    const secondInput = xudtCell(30n, type, script("23"));
    secondInput.outPoint.index = 1n;
    const signer = signerWithCells(
      [xudtCell(150n, type), secondInput],
      clientWithHeader(ccc.ClientBlockHeader.from(headerLike(10000000000000000n))),
    );

    const completed = await ickbUdt.completeBy(tx, signer);

    expect(completed.inputs).toHaveLength(2);
    expect(completed.outputsData).toContain(ccc.hexFrom(ccc.numLeToBytes(80n, 16)));
  });

  it("does not count receipt inputs as xUDT inputs for overfunding", async () => {
    const { ickbUdt, logic, type } = testIckbUdt();
    const header = ccc.ClientBlockHeader.from(headerLike(10000000000000000n));
    const tx = ccc.Transaction.from({
      outputs: [{ lock: script("22"), type }],
      outputsData: [ccc.numLeToBytes(100n, 16)],
    });
    tx.addInput(receiptCell(receiptOutputData(1, 40n), logic));
    const secondInput = xudtCell(5n, type, script("23"));
    secondInput.outPoint.index = 1n;
    const signer = signerWithCells(
      [xudtCell(80n, type), secondInput],
      clientWithHeader(header),
    );

    const completed = await ickbUdt.completeBy(tx, signer);

    expect(completed.inputs).toHaveLength(3);
    expect(completed.outputsData).toContain(ccc.hexFrom(ccc.numLeToBytes(25n, 16)));
  });

  it("does not count receipt inputs toward existing xUDT overfunding", async () => {
    const { ickbUdt, logic, type } = testIckbUdt();
    const header = ccc.ClientBlockHeader.from(headerLike(10000000000000000n));
    const existingXudt = xudtCell(80n, type);
    const tx = ccc.Transaction.from({
      inputs: [existingXudt],
      outputs: [{ lock: script("22"), type }],
      outputsData: [ccc.numLeToBytes(100n, 16)],
    });
    tx.addInput(receiptCell(receiptOutputData(1, 40n), logic));
    const secondInput = xudtCell(5n, type, script("23"));
    secondInput.outPoint.index = 1n;
    const signer = signerWithCells([secondInput], clientWithHeader(header));

    const completed = await ickbUdt.completeBy(tx, signer);

    expect(completed.inputs).toHaveLength(3);
    expect(completed.outputsData).toContain(ccc.hexFrom(ccc.numLeToBytes(25n, 16)));
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
    ickbUdt: new IckbUdt(
      xudtCode,
      type,
      logicCode,
      logic,
      new DaoManager(script("77"), []),
    ),
    logic,
    logicCode,
    type,
    xudtCode,
  };
}
