import { ccc } from "@ckb-ccc/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DaoManager } from "@ickb/dao";
import { collect } from "@ickb/utils";
import { ReceiptData } from "./entities.js";
import { LogicManager } from "./logic.js";

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

describe("LogicManager.deposit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("encodes receipt amounts from deposit free capacity", async () => {
    vi.spyOn(ccc, "isDaoOutputLimitExceeded").mockResolvedValue(false);

    const logic = script("11");
    const dao = script("22");
    const user = script("33");
    const manager = new LogicManager(logic, [], new DaoManager(dao, []));

    const tx = await manager.deposit(
      ccc.Transaction.default(),
      2,
      ccc.fixedPointFrom(100082),
      user,
      {} as ccc.Client,
    );

    expect(tx.outputs).toHaveLength(3);
    expect(tx.outputs[0]?.capacity).toBe(ccc.fixedPointFrom(100082));
    expect(tx.outputs[1]?.capacity).toBe(ccc.fixedPointFrom(100082));

    const receiptData = tx.outputsData[2];
    if (!receiptData) {
      throw new Error("Expected receipt output data");
    }

    const receipt = ReceiptData.decode(receiptData);
    expect(receipt.depositQuantity).toBe(2n);
    expect(receipt.depositAmount).toBe(ccc.fixedPointFrom(100000));
  });

  it("keeps the protocol minimum on unoccupied capacity", async () => {
    vi.spyOn(ccc, "isDaoOutputLimitExceeded").mockResolvedValue(false);

    const manager = new LogicManager(script("11"), [], new DaoManager(script("22"), []));

    await expect(
      manager.deposit(
        ccc.Transaction.default(),
        1,
        ccc.fixedPointFrom(1081),
        script("33"),
        {} as ccc.Client,
      ),
    ).rejects.toThrow(
      "iCKB deposit minimum is 1000 CKB free capacity (1082 CKB total capacity)",
    );
  });

  it("keeps the protocol maximum on unoccupied capacity", async () => {
    vi.spyOn(ccc, "isDaoOutputLimitExceeded").mockResolvedValue(false);

    const manager = new LogicManager(script("11"), [], new DaoManager(script("22"), []));

    await expect(
      manager.deposit(
        ccc.Transaction.default(),
        1,
        ccc.fixedPointFrom(1000083),
        script("33"),
        {} as ccc.Client,
      ),
    ).rejects.toThrow(
      "iCKB deposit maximum is 1000000 CKB free capacity (1000082 CKB total capacity)",
    );
  });

  it("filters receipts by exact lock and type while deduplicating locks", async () => {
    const logic = script("11");
    const wantedLock = script("22");
    const otherLock = script("33");
    const receiptData = ReceiptData.from({
      depositQuantity: 1,
      depositAmount: ccc.fixedPointFrom(100000),
    }).toBytes();
    const validReceipt = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("44"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: wantedLock,
        type: logic,
      },
      outputData: receiptData,
    });
    const wrongLock = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("55"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: otherLock,
        type: logic,
      },
      outputData: receiptData,
    });
    const wrongType = ccc.Cell.from({
      outPoint: { txHash: byte32FromByte("66"), index: 0n },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: wantedLock,
        type: script("77"),
      },
      outputData: receiptData,
    });
    const header = ccc.ClientBlockHeader.from({
      compactTarget: 0n,
      dao: { c: 0n, ar: 10000000000000000n, s: 0n, u: 0n },
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
    });
    let calls = 0;
    const client = {
      findCells: async function* () {
        await Promise.resolve();
        calls += 1;
        yield validReceipt;
        yield wrongLock;
        yield wrongType;
      },
      getTransactionWithHeader: async () => {
        await Promise.resolve();
        return { header };
      },
    } as unknown as ccc.Client;
    const manager = new LogicManager(logic, [], new DaoManager(script("88"), []));

    const receipts = await collect(
      manager.findReceipts(client, [wantedLock, wantedLock]),
    );

    expect(calls).toBe(1);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.cell.outPoint.txHash).toBe(byte32FromByte("44"));
  });
});
