import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { DaoManager } from "../../../src/core/index.ts";
import {
  convert,
  ickbAccountingRatio,
  ickbExchangeRatio,
  IckbUdt,
  ickbValue,
} from "../../../src/core/udt.ts";
import {
  byte32FromByte,
  clientWithHeader,
  headerLike,
  RECEIPT_PREFIX_DECODING_SUITE,
  receiptCell,
  receiptOutputData,
  script,
  StubClient,
  xudtCell,
} from "../cells/support/cells_support.ts";

describe(RECEIPT_PREFIX_DECODING_SUITE, () => {
  registerInputBalanceTests();
  registerInputBalanceErrorTests();
  registerOutputBalanceAndChangeTests();
});

function registerInputBalanceTests(): void {
  it("values xUDT inputs and ignores unrelated or prefix-matching foreign cells", async () => {
    const { ickbUdt, type } = testIckbUdt();
    const prefixedType = ccc.Script.from({
      codeHash: type.codeHash,
      hashType: type.hashType,
      args: `${type.args}00`,
    });
    const foreign = xudtCell(900n, prefixedType);
    foreign.outPoint.index = 1n;
    const unrelated = xudtCell(700n, script("aa"));
    unrelated.outPoint.index = 2n;
    const tx = ccc.Transaction.from({
      inputs: [xudtCell(100n, type), foreign, unrelated],
    });

    await expect(
      ickbUdt.inputBalance(tx, clientWithHeader(headerLike(1n))),
    ).resolves.toBe(100n);
  });

  it("values receipt inputs at their deposit header", async () => {
    const { ickbUdt, logic } = testIckbUdt();
    const header = ccc.ClientBlockHeader.from(headerLike(10000000000000000n));
    const tx = ccc.Transaction.default();
    tx.addInput(receiptCell(receiptOutputData(1, 100n), logic));

    await expect(ickbUdt.inputBalance(tx, clientWithHeader(header))).resolves.toBe(
      ickbValue(100n, header),
    );
  });

  it("values first-phase deposit inputs as negative iCKB", async () => {
    const logic = script("33");
    const dao = script("44");
    const header = ccc.ClientBlockHeader.from(headerLike(10000000000000000n));
    const deposit = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("88"), index: 0n },
      cellOutput: { capacity: ccc.fixedPointFrom(100082), lock: logic, type: dao },
      outputData: "0x0000000000000000",
    });
    const ickbUdt = new IckbUdt({
      code: { txHash: byte32FromByte("44"), index: 1n },
      script: script("55"),
      logicCode: { txHash: byte32FromByte("66"), index: 2n },
      logicScript: logic,
      daoManager: new DaoManager(dao, []),
    });
    const tx = ccc.Transaction.default();
    tx.addInput(deposit);

    await expect(ickbUdt.inputBalance(tx, clientWithHeader(header))).resolves.toBe(
      -ickbValue(deposit.capacityFree, header),
    );
  });

  it("ignores protocol-shaped inputs without out points", async () => {
    const { ickbUdt, logic } = testIckbUdt();
    const tx = ccc.Transaction.default();
    tx.inputs.push(new DetachedProtocolInput(logic));

    await expect(
      ickbUdt.inputBalance(tx, clientWithHeader(headerLike(1n))),
    ).resolves.toBe(0n);
  });
}

function registerInputBalanceErrorTests(): void {
  it("throws when a protocol input header is unavailable", async () => {
    const { ickbUdt, receipt, tx } = protocolReceiptCase();
    const client = new StubClient({
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        await Promise.resolve();
        return undefined;
      },
    });

    await expect(ickbUdt.inputBalance(tx, client)).rejects.toThrow(
      `Header not found for txHash ${receipt.outPoint.txHash} at ${receipt.outPoint.toHex()}`,
    );
  });

  it("rejects malformed receipt inputs with out point context", async () => {
    const { ickbUdt, logic } = testIckbUdt();
    const receipt = receiptCell("0x12", logic);
    const tx = ccc.Transaction.from({ inputs: [receipt] });

    await expect(
      ickbUdt.inputBalance(tx, clientWithHeader(headerLike(1n))),
    ).rejects.toThrow(
      `Invalid iCKB receipt payload at ${receipt.outPoint.toHex()}: 0x12`,
    );
  });

  it("preserves the protocol input out point when the header read fails", async () => {
    const { ickbUdt, receipt, tx } = protocolReceiptCase();
    const headerError = new Error("header rpc failed");
    const client = new StubClient({
      getTransactionWithHeader: async (): ReturnType<
        ccc.Client["getTransactionWithHeader"]
      > => {
        await Promise.resolve();
        throw headerError;
      },
    });

    await expect(ickbUdt.inputBalance(tx, client)).rejects.toMatchObject({
      message: `Failed to load transaction header for txHash ${receipt.outPoint.txHash} at ${receipt.outPoint.toHex()}`,
      cause: headerError,
    });
  });

  it("preserves the input out point when loading an input cell fails", async () => {
    const { ickbUdt } = testIckbUdt();
    const inputError = new Error("source cell missing");
    const missingOutPoint = ccc.OutPoint.from({
      txHash: byte32FromByte("ac"),
      index: 2n,
    });
    const tx = ccc.Transaction.default();
    tx.inputs.push(new MissingInput(missingOutPoint, inputError));

    await expect(ickbUdt.inputBalance(tx, new StubClient())).rejects.toMatchObject({
      message: `Failed to load input cell ${missingOutPoint.toHex()}`,
      cause: inputError,
    });
  });
}

function registerOutputBalanceAndChangeTests(): void {
  it("sums only iCKB outputs and adds change only for a positive surplus", () => {
    const { ickbUdt, type } = testIckbUdt();
    const tx = ccc.Transaction.from({
      outputs: [
        { lock: script("22"), type: script("bb") },
        { lock: script("22"), type },
      ],
      outputsData: [ccc.numLeToBytes(900n, 16), ccc.numLeToBytes(100n, 16)],
    });

    expect(ickbUdt.outputBalance(tx)).toBe(100n);
    ickbUdt.addChange(tx, script("22"), 0n);
    expect(tx.outputs).toHaveLength(2);
    ickbUdt.addChange(tx, script("22"), 30n);
    expect(tx.outputs).toHaveLength(3);
    expect(tx.outputs[2]?.type?.eq(type)).toBe(true);
    expect(tx.outputsData[2]).toBe(ccc.hexFrom(ccc.numLeToBytes(30n, 16)));
    expect(ickbUdt.outputBalance(tx)).toBe(130n);
  });
}

function protocolReceiptCase(): {
  ickbUdt: IckbUdt;
  receipt: ccc.Cell;
  tx: ccc.Transaction;
} {
  const { ickbUdt, logic } = testIckbUdt();
  const receipt = receiptCell(receiptOutputData(1, 100n), logic);
  return { ickbUdt, receipt, tx: ccc.Transaction.from({ inputs: [receipt] }) };
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
