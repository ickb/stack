import { ccc } from "@ckb-ccc/core";
import { describe, expect, it } from "vitest";
import { DaoManager } from "@ickb/dao";
import { receiptCellFrom } from "./cells.js";
import { ReceiptData } from "./entities.js";
import { IckbUdt, ickbValue } from "./udt.js";

function byte32FromByte(hexByte: string): `0x${string}` {
  if (!/^[0-9a-f]{2}$/iu.test(hexByte)) {
    throw new Error("Expected exactly one byte as two hex chars");
  }
  return `0x${hexByte.repeat(32)}`;
}

function script(codeHashByte: string): ccc.Script {
  return ccc.Script.from({
    codeHash: byte32FromByte(codeHashByte),
    hashType: "type",
    args: "0x",
  });
}

function headerLike(ar: bigint): {
  compactTarget: bigint;
  dao: {
    c: bigint;
    ar: bigint;
    s: bigint;
    u: bigint;
  };
  epoch: [bigint, bigint, bigint];
  extraHash: `0x${string}`;
  hash: `0x${string}`;
  nonce: bigint;
  number: bigint;
  parentHash: `0x${string}`;
  proposalsHash: `0x${string}`;
  timestamp: bigint;
  transactionsRoot: `0x${string}`;
  version: bigint;
} {
  return {
    compactTarget: 0n,
    dao: {
      c: 0n,
      ar,
      s: 0n,
      u: 0n,
    },
    epoch: [1n, 0n, 1n],
    extraHash: byte32FromByte("aa"),
    hash: byte32FromByte("bb"),
    nonce: 0n,
    number: 1n,
    parentHash: byte32FromByte("cc"),
    proposalsHash: byte32FromByte("dd"),
    timestamp: 0n,
    transactionsRoot: byte32FromByte("ee"),
    version: 0n,
  };
}

function clientWithHeader(header: ccc.ClientBlockHeader): ccc.Client {
  return {
    getTransactionWithHeader: () => Promise.resolve({ header }),
  } as unknown as ccc.Client;
}

function receiptOutputData(
  depositQuantity: number,
  depositAmount: ccc.FixedPoint,
): ccc.Hex {
  return ccc.hexFrom([
    ...ReceiptData.from({ depositQuantity, depositAmount }).toBytes(),
    0xab,
    0xcd,
  ]);
}

function receiptCell(outputData: ccc.Hex, logic: ccc.Script): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte("11"), index: 0n },
    cellOutput: {
      capacity: ccc.fixedPointFrom(100082),
      lock: script("22"),
      type: logic,
    },
    outputData,
  });
}

describe("receipt prefix decoding", () => {
  it("lets receiptCellFrom ignore trailing bytes", async () => {
    const logic = script("33");
    const header = ccc.ClientBlockHeader.from(headerLike(10000000000000000n));
    const outputData = receiptOutputData(2, ccc.fixedPointFrom(100000));

    const receipt = await receiptCellFrom({
      cell: receiptCell(outputData, logic),
      client: clientWithHeader(header),
    });

    expect(receipt.ckbValue).toBe(ccc.fixedPointFrom(100082));
    expect(receipt.udtValue).toBe(ccc.fixedPointFrom(200000));
  });

  it("lets IckbUdt.infoFrom value receipt prefixes with trailing bytes", async () => {
    const logic = script("33");
    const header = ccc.ClientBlockHeader.from(headerLike(10000000000000000n));
    const outputData = receiptOutputData(3, ccc.fixedPointFrom(100000));
    const cell = receiptCell(outputData, logic);
    const ickbUdt = new IckbUdt(
      { txHash: byte32FromByte("44"), index: 0n },
      script("55"),
      { txHash: byte32FromByte("66"), index: 0n },
      logic,
      new DaoManager(script("77"), []),
    );

    const info = await ickbUdt.infoFrom(clientWithHeader(header), cell);

    expect(info.balance).toBe(ickbValue(ccc.fixedPointFrom(100000), header) * 3n);
    expect(info.capacity).toBe(ccc.fixedPointFrom(100082));
    expect(info.count).toBe(1);
  });

  it("subtracts deposit value from UDT balance info", async () => {
    const logic = script("33");
    const dao = script("44");
    const header = ccc.ClientBlockHeader.from(headerLike(10000000000000000n));
    const cell = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("88"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: logic,
        type: dao,
      },
      outputData: "0x0000000000000000",
    });
    const ickbUdt = new IckbUdt(
      { txHash: byte32FromByte("44"), index: 0n },
      script("55"),
      { txHash: byte32FromByte("66"), index: 0n },
      logic,
      new DaoManager(dao, []),
    );

    const info = await ickbUdt.infoFrom(clientWithHeader(header), cell);

    expect(info.balance).toBe(-ickbValue(cell.capacityFree, header));
    expect(info.capacity).toBe(ccc.fixedPointFrom(100082));
    expect(info.count).toBe(1);
  });

  it("adds xUDT and logic code deps explicitly", () => {
    const logic = script("33");
    const xudtCode = { txHash: byte32FromByte("44"), index: 1n };
    const logicCode = { txHash: byte32FromByte("66"), index: 2n };
    const ickbUdt = new IckbUdt(
      xudtCode,
      script("55"),
      logicCode,
      logic,
      new DaoManager(script("77"), []),
    );

    const tx = ickbUdt.addCellDeps(ccc.Transaction.default());

    expect(tx.cellDeps).toHaveLength(2);
    expect(tx.cellDeps[0]?.depType).toBe("code");
    expect(tx.cellDeps[0]?.outPoint.eq(ccc.OutPoint.from(xudtCode))).toBe(true);
    expect(tx.cellDeps[1]?.depType).toBe("code");
    expect(tx.cellDeps[1]?.outPoint.eq(ccc.OutPoint.from(logicCode))).toBe(true);
  });
});
