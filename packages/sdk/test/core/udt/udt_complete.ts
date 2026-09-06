import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import {
  convert,
  ickbAccountingRatio,
  ickbExchangeRatio,
  IckbUdt,
  ickbValue,
} from "../../../src/core/udt.ts";
import { DaoManager } from "../../../src/dao/index.ts";
import { PagedScanBudget } from "../../../src/utils/index.ts";
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
  registerCompleteByCollectionTests();
  registerCompleteByExistingInputTests();
  registerCompleteByBudgetTests();
  registerCompleteByErrorTests();
  registerCompleteByContextErrorTests();
  registerCompleteByProtocolInputTests();
});

function registerCompleteByCollectionTests(): void {
  it("completeBy ignores unrelated inputs and outputs", async () => {
    const { ickbUdt, type } = testIckbUdt();
    const unrelatedInput = xudtCell(100n, script("aa"));
    unrelatedInput.outPoint.index = 1n;
    const tx = ccc.Transaction.from({
      inputs: [unrelatedInput],
      outputs: [
        { lock: script("22"), type: script("bb") },
        { lock: script("22"), type },
      ],
      outputsData: [ccc.numLeToBytes(900n, 16), ccc.numLeToBytes(100n, 16)],
    });
    const signer = signerWithCells(
      [xudtCell(100n, type)],
      clientWithHeader(headerLike(1n)),
    );

    const completed = await ickbUdt.completeBy(tx, signer);

    expect(completed.inputs).toHaveLength(2);
    expect(completed.outputs).toHaveLength(2);
  });

  it("completeBy does not add change or second input on exact xUDT match", async () => {
    const { ickbUdt, type } = testIckbUdt();
    const tx = ccc.Transaction.from({
      outputs: [{ lock: script("22"), type }],
      outputsData: [ccc.numLeToBytes(100n, 16)],
    });
    const signer = signerWithCells(
      [xudtCell(100n, type), xudtCell(50n, type, script("23"))],
      clientWithHeader(headerLike(1n)),
    );

    const completed = await ickbUdt.completeBy(tx, signer);

    expect(completed.inputs).toHaveLength(1);
    expect(completed.outputs).toHaveLength(1);
  });

  it("completeBy does not consume prefix-matching foreign xUDT cells", async () => {
    const { ickbUdt, type } = testIckbUdt();
    const prefixedType = ccc.Script.from({
      codeHash: type.codeHash,
      hashType: type.hashType,
      args: `${type.args}00`,
    });
    const foreign = xudtCell(900n, prefixedType);
    foreign.outPoint.index = 1n;
    const exact = xudtCell(100n, type);
    exact.outPoint.index = 2n;
    const tx = ccc.Transaction.from({
      outputs: [{ lock: script("22"), type }],
      outputsData: [ccc.numLeToBytes(100n, 16)],
    });
    const signer = signerWithCells([foreign, exact], clientWithHeader(headerLike(1n)));

    const completed = await ickbUdt.completeBy(tx, signer);

    expect(completed.inputs).toHaveLength(1);
    expect(completed.inputs[0]?.previousOutput.eq(exact.outPoint)).toBe(true);
  });
}

function registerCompleteByExistingInputTests(): void {
  it("completeBy changes existing two xUDT input surplus without collecting more", async () => {
    const { ickbUdt, type } = testIckbUdt();
    const firstInput = xudtCell(80n, type);
    const secondInput = xudtCell(50n, type, script("23"));
    secondInput.outPoint.index = 1n;
    const tx = ccc.Transaction.from({
      inputs: [firstInput, secondInput],
      outputs: [{ lock: script("22"), type }],
      outputsData: [ccc.numLeToBytes(100n, 16)],
    });
    const signer = signerWithCells(
      [xudtCell(200n, type, script("24"))],
      clientWithHeader(headerLike(1n)),
    );

    const completed = await ickbUdt.completeBy(tx, signer);

    expect(completed.inputs).toHaveLength(2);
    expect(completed.outputsData).toContain(ccc.hexFrom(ccc.numLeToBytes(30n, 16)));
  });
}

function registerCompleteByBudgetTests(): void {
  it("completeBy charges a supplied aggregate scan budget", async () => {
    const { ickbUdt, type } = testIckbUdt();
    const tx = ccc.Transaction.from({
      outputs: [{ lock: script("22"), type }],
      outputsData: [ccc.numLeToBytes(100n, 16)],
    });
    const signer = signerWithCells(
      [xudtCell(100n, type)],
      clientWithHeader(headerLike(1n)),
    );
    const budget = new PagedScanBudget(1, 1, {
      aborted: true,
      reason: new Error("aggregate preview expired"),
    });

    await expect(ickbUdt.completeBy(tx, signer, { budget })).rejects.toMatchObject({
      name: "PagedScanBudgetError",
      reason: "aborted",
    });
  });
}

function registerCompleteByErrorTests(): void {
  it("completeBy throws when iCKB balance is insufficient", async () => {
    const { ickbUdt, type } = testIckbUdt();
    const tx = ccc.Transaction.from({
      outputs: [{ lock: script("22"), type }],
      outputsData: [ccc.numLeToBytes(100n, 16)],
    });
    const signer = signerWithCells(
      [xudtCell(40n, type)],
      clientWithHeader(headerLike(1n)),
    );

    await expect(ickbUdt.completeBy(tx, signer)).rejects.toThrow(
      "Insufficient iCKB, need 60 more",
    );
  });

  it("completeBy throws when protocol input headers are unavailable", async () => {
    const { ickbUdt, receipt, tx } = protocolReceiptCompletionCase();
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

  it("completeBy rejects malformed receipt inputs with out point context", async () => {
    const { ickbUdt, logic, type } = testIckbUdt();
    const receipt = receiptCell("0x12", logic);
    const tx = ccc.Transaction.from({
      inputs: [receipt],
      outputs: [{ lock: script("22"), type }],
      outputsData: [ccc.numLeToBytes(1n, 16)],
    });
    const signer = signerWithCells([], clientWithHeader(headerLike(1n)));

    await expect(ickbUdt.completeBy(tx, signer)).rejects.toThrow(
      `Invalid iCKB receipt payload at ${receipt.outPoint.toHex()}: 0x12`,
    );
  });

  it("ignores protocol-shaped inputs without out points", async () => {
    const { ickbUdt, logic } = testIckbUdt();
    const tx = ccc.Transaction.default();
    tx.inputs.push(new DetachedProtocolInput(logic));
    const signer = signerWithCells([], clientWithHeader(headerLike(1n)));

    const completed = await ickbUdt.completeBy(tx, signer);

    expect(completed.inputs).toHaveLength(1);
  });
}

function registerCompleteByContextErrorTests(): void {
  it("completeBy preserves protocol input out point when header reads fail", async () => {
    const { ickbUdt, receipt, tx } = protocolReceiptCompletionCase();
    const headerError = new Error("header rpc failed");
    const signer = signerWithCells(
      [],
      new StubClient({
        getTransactionWithHeader: async (): ReturnType<
          ccc.Client["getTransactionWithHeader"]
        > => {
          await Promise.resolve();
          throw headerError;
        },
      }),
    );

    await expect(ickbUdt.completeBy(tx, signer)).rejects.toMatchObject({
      message: `Failed to load transaction header for txHash ${receipt.outPoint.txHash} at ${receipt.outPoint.toHex()}`,
      cause: headerError,
    });
  });

  it("completeBy preserves input out point when existing input loading fails", async () => {
    const { ickbUdt, type } = testIckbUdt();
    const inputError = new Error("source cell missing");
    const missingOutPoint = ccc.OutPoint.from({
      txHash: byte32FromByte("ac"),
      index: 2n,
    });
    const tx = ccc.Transaction.from({
      outputs: [{ lock: script("22"), type }],
      outputsData: [ccc.numLeToBytes(1n, 16)],
    });
    tx.inputs.push(new MissingInput(missingOutPoint, inputError));
    const signer = signerWithCells([], new StubClient());

    await expect(ickbUdt.completeBy(tx, signer)).rejects.toMatchObject({
      message: `Failed to load input cell ${missingOutPoint.toHex()}`,
      cause: inputError,
    });
  });
}

function protocolReceiptCompletionCase(): {
  ickbUdt: IckbUdt;
  receipt: ccc.Cell;
  tx: ccc.Transaction;
} {
  const { ickbUdt, logic, type } = testIckbUdt();
  const receipt = receiptCell(receiptOutputData(1, 100n), logic);
  return {
    ickbUdt,
    receipt,
    tx: ccc.Transaction.from({
      inputs: [receipt],
      outputs: [{ lock: script("22"), type }],
      outputsData: [ccc.numLeToBytes(50n, 16)],
    }),
  };
}

class DetachedProtocolInput extends ccc.CellInput {
  private readonly logic: ccc.Script;

  constructor(logic: ccc.Script) {
    super(new ccc.OutPoint(byte32FromByte("ab"), 0n), 0n);
    this.logic = logic;
  }

  public override async getCell(): Promise<ccc.Cell> {
    await Promise.resolve();
    const cell = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("ab"), index: 0n },
      cellOutput: { capacity: 61n, lock: script("22"), type: this.logic },
      outputData: receiptOutputData(1, 100n),
    });
    Reflect.deleteProperty(cell, "outPoint");
    return cell;
  }
}

class MissingInput extends ccc.CellInput {
  private readonly error: Error;

  constructor(outPoint: ccc.OutPoint, error: Error) {
    super(outPoint, 0n);
    this.error = error;
  }

  public override async getCell(): Promise<ccc.Cell> {
    await Promise.resolve();
    throw this.error;
  }
}

function registerCompleteByProtocolInputTests(): void {
  it("completeBy values existing receipt inputs before adding xUDT inputs", async () => {
    const { ickbUdt, logic, type } = testIckbUdt();
    const header = ccc.ClientBlockHeader.from(headerLike(10000000000000000n));
    const receipt = receiptCell(receiptOutputData(1, 100n), logic);
    const tx = ccc.Transaction.from({
      outputs: [{ lock: script("22"), type }],
      outputsData: [ccc.numLeToBytes(150n, 16)],
    });
    tx.addInput(receipt);
    const signer = signerWithCells([xudtCell(100n, type)], clientWithHeader(header));

    const completed = await ickbUdt.completeBy(tx, signer);

    expect(completed.inputs).toHaveLength(2);
    expect(completed.outputsData).toContain(ccc.hexFrom(ccc.numLeToBytes(50n, 16)));
    expect(completed.cellDeps).toHaveLength(2);
  });

  it("completeBy accounts deposit inputs as negative iCKB", async () => {
    const logic = script("33");
    const dao = script("44");
    const type = script("55");
    const header = ccc.ClientBlockHeader.from(headerLike(10000000000000000n));
    const deposit = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("88"), index: 0n },
      cellOutput: { capacity: ccc.fixedPointFrom(100082), lock: logic, type: dao },
      outputData: "0x0000000000000000",
    });
    const ickbUdt = new IckbUdt({
      code: { txHash: byte32FromByte("44"), index: 1n },
      script: type,
      logicCode: { txHash: byte32FromByte("66"), index: 2n },
      logicScript: logic,
      daoManager: new DaoManager(dao, []),
    });
    const tx = ccc.Transaction.from({
      outputs: [{ lock: script("22"), type }],
      outputsData: [ccc.numLeToBytes(50n, 16)],
    });
    tx.addInput(deposit);
    const signer = signerWithCells(
      [xudtCell(ickbValue(deposit.capacityFree, header) + 50n, type)],
      clientWithHeader(header),
    );

    const completed = await ickbUdt.completeBy(tx, signer);

    expect(completed.inputs).toHaveLength(2);
    expect(completed.outputs).toHaveLength(1);
  });
}

function testIckbUdt(): { ickbUdt: IckbUdt; logic: ccc.Script; type: ccc.Script } {
  const logic = script("33");
  const type = script("55");
  return {
    ickbUdt: new IckbUdt({
      code: { txHash: byte32FromByte("44"), index: 1n },
      script: type,
      logicCode: { txHash: byte32FromByte("66"), index: 2n },
      logicScript: logic,
      daoManager: new DaoManager(script("77"), []),
    }),
    logic,
    type,
  };
}

describe("IckbUdt.typeScriptFrom", () => {
  it("builds xUDT owner-mode args from the iCKB logic script hash", () => {
    const rawXudt = script("55");
    const logic = script("33");

    const type = IckbUdt.typeScriptFrom(rawXudt, logic);

    expect(type.codeHash).toBe(rawXudt.codeHash);
    expect(type.hashType).toBe(rawXudt.hashType);
    expect(type.args).toBe(
      "0xe53fd3c784cec05e3188b42f221ff28505169c9048ebb8b5f3e2d96a4fd9d26b00000080",
    );
    expect(ccc.bytesFrom(type.args)).toHaveLength(36);
  });
});

describe("iCKB conversion", () => {
  it("converts from iCKB to CKB using explicit ratios and header ratios", () => {
    const header = ccc.ClientBlockHeader.from(headerLike(10000000000000000n));

    expect(convert(false, 6n, { ckbScale: 2n, udtScale: 3n })).toBe(9n);
    expect(convert(true, ccc.fixedPointFrom(1000), ickbAccountingRatio(header))).toBe(
      ccc.fixedPointFrom(1000),
    );
    expect(ickbExchangeRatio(header).udtScale).toBe(
      header.dao.ar +
        (ccc.fixedPointFrom(82) * 10000000000000000n) / ccc.fixedPointFrom(100000),
    );
    expect(ickbAccountingRatio(header).udtScale).toBe(header.dao.ar);
  });

  it("rejects non-positive exchange ratio scales", () => {
    expect(() => convert(true, 1n, { ckbScale: 0n, udtScale: 1n })).toThrow(
      "Exchange ratio scales must be positive",
    );
    expect(() => convert(false, 1n, { ckbScale: 1n, udtScale: -1n })).toThrow(
      "Exchange ratio scales must be positive",
    );
  });
});
