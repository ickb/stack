import { ccc } from "@ckb-ccc/core";
import {
  byte32FromByte,
  depositToIckb,
  script,
  StubClient,
  headerLike as testHeaderLike,
} from "@ickb/testkit";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DAO_DEPOSIT_DATA } from "../../src/dao.ts";
import {
  ckbFromUdt,
  encodeReceiptData,
  ickbAccountingRatio,
  ickbExchangeRatio,
  IckbUdt,
  ickbValue,
  udtFromCkb,
} from "../../src/udt.ts";

// This package is browser-safe and loads no node types; declare the one node
// global the seed hook needs instead of widening the package's program.
declare const process: { env: Record<string, string | undefined> };

const seedText = process.env["VITEST_FC_SEED"];
fc.configureGlobal({
  numRuns: 250,
  ...(seedText === undefined ? {} : { seed: Number(seedText) }),
});

const logic = script("33");
const daoScript = script("44");
const type = script("55");
const lock = script("22");

function headerLike(ar: bigint): ccc.ClientBlockHeader {
  return testHeaderLike({
    dao: { c: 0n, ar, s: 0n, u: 0n },
    epoch: [1n, 0n, 1n],
    number: 1n,
  });
}

function udt(): IckbUdt {
  return new IckbUdt({
    script: type,
    cellDeps: [],
    logicScript: logic,
    daoScript,
  });
}

function receiptCell(outputData: ccc.Hex, txHashByte = "11"): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte(txHashByte), index: 0n },
    cellOutput: { capacity: ccc.fixedPointFrom(100082), lock, type: logic },
    outputData,
  });
}

function receiptOutputData(
  depositQuantity: bigint,
  depositAmount: ccc.FixedPoint,
): ccc.Hex {
  return ccc.hexFrom([
    ...encodeReceiptData({ depositQuantity, depositAmount }),
    0xab,
    0xcd,
  ]);
}

function xudtCell(balance: ccc.Num, cellType = type, txHashByte = "99"): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte(txHashByte), index: 0n },
    cellOutput: { capacity: ccc.fixedPointFrom(100), lock, type: cellType },
    outputData: ccc.numLeToBytes(balance, 16),
  });
}

function depositCell(txHashByte = "88", cellLock = logic): ccc.Cell {
  return ccc.Cell.from({
    outPoint: { txHash: byte32FromByte(txHashByte), index: 0n },
    cellOutput: { capacity: ccc.fixedPointFrom(100082), lock: cellLock, type: daoScript },
    outputData: DAO_DEPOSIT_DATA,
  });
}

function transactionWithInputs(...cells: ccc.Cell[]): ccc.Transaction {
  const tx = ccc.Transaction.default();
  for (const cell of cells) {
    tx.addInput(cell);
  }
  return tx;
}

describe("IckbUdt.typeScriptFrom", () => {
  it("builds xUDT owner-mode args from the iCKB logic script hash", () => {
    const rawUdt = script("aa");

    const derived = IckbUdt.typeScriptFrom(rawUdt, logic);

    expect(derived.codeHash).toBe(rawUdt.codeHash);
    expect(derived.hashType).toBe(rawUdt.hashType);
    expect(derived.args).toBe(`${logic.hash()}00000080`);
  });

  it("sizes an xUDT cell from the lock's occupied size", () => {
    const shortLock = script("44");
    const longLock = script("44", `0x${"ab".repeat(40)}`);

    expect(
      IckbUdt.minimumXudtCellCapacity(longLock) -
        IckbUdt.minimumXudtCellCapacity(shortLock),
    ).toBe(40n * ccc.One);
  });
});

describe("IckbUdt cell deps and shapes", () => {
  it("identifies only xUDT cells with UDT data", () => {
    expect(udt().isUdt(xudtCell(1n))).toBe(true);
    expect(udt().isUdt(xudtCell(1n, script("77")))).toBe(false);
    expect(udt().isUdt({ cellOutput: { lock, type }, outputData: "0x01" })).toBe(false);
  });
});

describe("IckbUdt.inputBalance", () => {
  it("values xUDT inputs and ignores unrelated or prefix-matching foreign cells", async () => {
    const foreign = xudtCell(7n, script("77"), "98");
    const plain = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("97"), index: 0n },
      cellOutput: { capacity: 100n, lock },
      outputData: "0x",
    });

    await expect(
      udt().inputBalance(
        transactionWithInputs(xudtCell(5n), foreign, plain),
        new StubClient(),
        [],
      ),
    ).resolves.toBe(5n);
  });

  it("adds a receipt and subtracts a logic-locked deposit at the state read's values", async () => {
    const receipt = receiptCell(receiptOutputData(3n, ccc.fixedPointFrom(100000)));
    const deposit = depositCell();
    const unspent = depositCell("89");
    // A deposit under another lock is not iCKB, whatever list it is in.
    const foreign = depositCell("87", script("21"));
    const tx = transactionWithInputs(receipt, deposit, foreign);

    await expect(
      udt().inputBalance(tx, new StubClient(), [
        { cell: receipt, udtValue: 11n },
        { cell: deposit, udtValue: 4n },
        { cell: unspent, udtValue: 100n },
        { cell: foreign, udtValue: 100n },
      ]),
    ).resolves.toBe(7n);
  });

  it("refuses a protocol input the state read did not value", async () => {
    const receipt = receiptCell(receiptOutputData(1n, ccc.fixedPointFrom(100000)));

    await expect(
      udt().inputBalance(transactionWithInputs(receipt), new StubClient(), []),
    ).rejects.toThrow(
      `iCKB input ${receipt.outPoint.toHex()} has no value from the state read`,
    );
  });
});

describe("IckbUdt outputs", () => {
  it("sums only iCKB outputs and adds change only for a positive surplus", () => {
    const tx = ccc.Transaction.from({
      outputs: [
        { lock, type },
        { lock, type: script("77") },
        { lock, type },
      ],
      outputsData: [
        ccc.numLeToBytes(5n, 16),
        ccc.numLeToBytes(9n, 16),
        ccc.numLeToBytes(6n, 16),
      ],
    });

    expect(tx.getOutputsUdtBalance(type)).toBe(11n);

    udt().addChange(tx, lock, 0n);
    expect(tx.outputs).toHaveLength(3);
    udt().addChange(tx, lock, 4n);
    expect(tx.outputs).toHaveLength(4);
    expect(tx.getOutputsUdtBalance(type)).toBe(15n);
  });
});

describe("iCKB conversion", () => {
  it("converts from iCKB to CKB using explicit ratios and header ratios", () => {
    const header = headerLike(20000000000000000n);

    expect(udtFromCkb(100n, { ckbScale: 1n, udtScale: 2n })).toBe(50n);
    expect(ckbFromUdt(100n, { ckbScale: 1n, udtScale: 2n })).toBe(200n);
    expect(ickbAccountingRatio(header)).toEqual({
      ckbScale: 10000000000000000n,
      udtScale: 20000000000000000n,
    });
    expect(ickbExchangeRatio(header).udtScale).toBeGreaterThan(
      ickbAccountingRatio(header).udtScale,
    );
  });

  it("rejects non-positive exchange ratio scales", () => {
    expect(() => udtFromCkb(1n, { ckbScale: 0n, udtScale: 1n })).toThrow(
      "Exchange ratio scales must be positive",
    );
  });

  it("ickbValue equals the oracle deposit_to_ickb across deposits and ARs", () => {
    const shannonsPerCkb = 10n ** 8n;
    // The deposit range reaches far above the 100_000 iCKB soft cap, so both the
    // undiscounted and the above-cap 10% discount branches are exercised.
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1000n * shannonsPerCkb, max: 1_000_000n * shannonsPerCkb }),
        fc.bigInt({ min: 10n ** 16n, max: 2n * 10n ** 16n }),
        (unoccupied, ar) => {
          expect(ickbValue(unoccupied, headerLike(ar))).toBe(
            depositToIckb(unoccupied, ar),
          );
        },
      ),
    );
  });

  it.each([
    { name: "ckb2udt then back", isCkb2Udt: true },
    { name: "udt2ckb then back", isCkb2Udt: false },
  ])("convert round trip ($name) never gains and loses boundedly", ({ isCkb2Udt }) => {
    const scaleArb = fc.bigInt({ min: 1n, max: 1n << 20n });
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 14n }),
        scaleArb,
        scaleArb,
        (amount, ckbScale, udtScale) => {
          const ratio = { ckbScale, udtScale };
          const across = (isCkb2Udt ? udtFromCkb : ckbFromUdt)(amount, ratio);
          const back = (isCkb2Udt ? ckbFromUdt : udtFromCkb)(across, ratio);
          // Forward floors amount*n/m, the return trip floors again, so the total
          // loss is ceil(r/n) for a remainder r < m: at most ceil((m - 1)/n).
          const [n, m] = isCkb2Udt ? [ckbScale, udtScale] : [udtScale, ckbScale];
          const maxLoss = (m - 1n + n - 1n) / n;
          expect(back).toBeLessThanOrEqual(amount);
          expect(amount - back).toBeLessThanOrEqual(maxLoss);
        },
      ),
    );
  });
});
