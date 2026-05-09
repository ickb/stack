import { ccc } from "@ckb-ccc/core";
import { describe, expect, it, vi } from "vitest";
import type { DaoDepositCell, DaoWithdrawalRequestCell } from "./cells.js";
import { DaoManager } from "./dao.js";

function byte32FromByte(hexByte: string): `0x${string}` {
  if (!/^[0-9a-f]{2}$/iu.test(hexByte)) {
    throw new Error("Expected exactly one byte as two hex chars");
  }
  return `0x${hexByte.repeat(32)}`;
}

function script(codeHashByte: string, args = "0x"): ccc.Script {
  return ccc.Script.from({
    codeHash: byte32FromByte(codeHashByte),
    hashType: "type",
    args,
  });
}

function headerLike(number: bigint): ccc.ClientBlockHeader {
  return ccc.ClientBlockHeader.from({
    compactTarget: 0n,
    dao: {
      c: 0n,
      ar: 1000n,
      s: 0n,
      u: 0n,
    },
    epoch: [1n, 0n, 1n],
    extraHash: byte32FromByte("aa"),
    hash: byte32FromByte("bb"),
    nonce: 0n,
    number,
    parentHash: byte32FromByte("cc"),
    proposalsHash: byte32FromByte("dd"),
    timestamp: 0n,
    transactionsRoot: byte32FromByte("ee"),
    version: 0n,
  });
}

function headerWithHash(number: bigint, hashByte: string): ccc.ClientBlockHeader {
  const header = headerLike(number);
  return ccc.ClientBlockHeader.from({
    compactTarget: header.compactTarget,
    dao: header.dao,
    epoch: header.epoch,
    extraHash: header.extraHash,
    hash: byte32FromByte(hashByte),
    nonce: header.nonce,
    number: header.number,
    parentHash: header.parentHash,
    proposalsHash: header.proposalsHash,
    timestamp: header.timestamp,
    transactionsRoot: header.transactionsRoot,
    version: header.version,
  });
}

function depositCell(
  manager: DaoManager,
  options?: {
    lock?: ccc.Script;
    txHashByte?: string;
    isReady?: boolean;
  },
): DaoDepositCell {
  const depositHeader = headerLike(1n);
  return {
    cell: ccc.Cell.from({
      outPoint: {
        txHash: byte32FromByte(options?.txHashByte ?? "22"),
        index: 0n,
      },
      cellOutput: {
        capacity: ccc.fixedPointFrom(100082),
        lock: options?.lock ?? script("33"),
        type: manager.script,
      },
      outputData: DaoManager.depositData(),
    }),
    isDeposit: true,
    headers: [{ header: depositHeader }, { header: depositHeader }],
    interests: 0n,
    maturity: ccc.Epoch.from([1n, 0n, 1n]),
    isReady: options?.isReady ?? true,
    ckbValue: ccc.fixedPointFrom(100082),
    udtValue: 0n,
  };
}

describe("DaoManager.requestWithdrawal", () => {
  it("always rejects withdrawal locks with different args size", async () => {
    vi.spyOn(ccc, "isDaoOutputLimitExceeded").mockResolvedValue(false);

    const manager = new DaoManager(script("11"), []);
    const deposit = depositCell(manager, { lock: script("33", "0x1234") });

    await expect(
      manager.requestWithdrawal(
        ccc.Transaction.default(),
        [deposit],
        script("44", "0x12"),
        {} as ccc.Client,
      ),
    ).rejects.toThrow("Withdrawal request lock args has different size from deposit");
  });

  it("keeps non-ready deposits unless isReadyOnly is set", async () => {
    vi.spyOn(ccc, "isDaoOutputLimitExceeded").mockResolvedValue(false);

    const manager = new DaoManager(script("11"), []);
    const pending = depositCell(manager, { isReady: false, txHashByte: "22" });
    const ready = depositCell(manager, { isReady: true, txHashByte: "23" });

    const tx = await manager.requestWithdrawal(
      ccc.Transaction.default(),
      [pending, ready],
      script("44"),
      {} as ccc.Client,
    );

    expect(tx.inputs).toHaveLength(2);
    expect(tx.outputs).toHaveLength(2);
    expect(tx.outputsData).toHaveLength(2);
  });

  it("filters non-ready deposits when isReadyOnly is set", async () => {
    vi.spyOn(ccc, "isDaoOutputLimitExceeded").mockResolvedValue(false);

    const manager = new DaoManager(script("11"), []);
    const pending = depositCell(manager, { isReady: false, txHashByte: "22" });
    const ready = depositCell(manager, { isReady: true, txHashByte: "23" });

    const tx = await manager.requestWithdrawal(
      ccc.Transaction.default(),
      [pending, ready],
      script("44"),
      {} as ccc.Client,
      { isReadyOnly: true },
    );

    expect(tx.inputs).toHaveLength(1);
    expect(tx.outputs).toHaveLength(1);
    expect(tx.inputs[0]?.previousOutput.txHash).toBe(ready.cell.outPoint.txHash);
  });

  it("requires matched input and output counts before appending requests", async () => {
    vi.spyOn(ccc, "isDaoOutputLimitExceeded").mockResolvedValue(false);

    const manager = new DaoManager(script("11"), []);
    const tx = ccc.Transaction.default();
    tx.addOutput(
      {
        capacity: ccc.fixedPointFrom(1000),
        lock: script("55"),
      },
      "0x",
    );

    await expect(
      manager.requestWithdrawal(
        tx,
        [depositCell(manager)],
        script("44"),
        {} as ccc.Client,
      ),
    ).rejects.toThrow("Transaction has different inputs and outputs lengths");
  });
});

describe("DaoManager cell decoding ownership", () => {
  it("rejects depositCellFrom on non-deposit cells", async () => {
    const manager = new DaoManager(script("11"), []);

    await expect(
      manager.depositCellFrom(
        ccc.Cell.from({
          outPoint: { txHash: byte32FromByte("22"), index: 0n },
          cellOutput: {
            capacity: ccc.fixedPointFrom(100082),
            lock: script("33"),
            type: manager.script,
          },
          outputData: ccc.mol.Uint64LE.encode(1n),
        }),
        {} as ccc.Client,
        { tip: headerLike(2n) },
      ),
    ).rejects.toThrow("Not a deposit");
  });

  it("rejects withdrawalRequestCellFrom on non-withdrawal cells", async () => {
    const manager = new DaoManager(script("11"), []);

    await expect(
      manager.withdrawalRequestCellFrom(
        depositCell(manager).cell,
        {} as ccc.Client,
        {
          tip: headerLike(2n),
        },
      ),
    ).rejects.toThrow("Not a withdrawal request");
  });
});

describe("DaoManager.withdraw", () => {
  it("writes since, header deps, and witness inputType for withdrawals", async () => {
    vi.spyOn(ccc, "isDaoOutputLimitExceeded").mockResolvedValue(false);

    const manager = new DaoManager(script("11"), []);
    const depositHeader = headerLike(1n);
    const withdrawHeader = headerWithHash(2n, "99");
    const withdrawal: DaoWithdrawalRequestCell = {
      cell: ccc.Cell.from({
        outPoint: { txHash: byte32FromByte("22"), index: 0n },
        cellOutput: {
          capacity: ccc.fixedPointFrom(100082),
          lock: script("33", "0x1234"),
          type: manager.script,
        },
        outputData: ccc.mol.Uint64LE.encode(depositHeader.number),
      }),
      isDeposit: false,
      headers: [{ header: depositHeader }, { header: withdrawHeader }],
      interests: 0n,
      maturity: ccc.Epoch.from([180n, 0n, 1n]),
      isReady: true,
      ckbValue: ccc.fixedPointFrom(100082),
      udtValue: 0n,
    };

    const tx = await manager.withdraw(
      ccc.Transaction.default(),
      [withdrawal],
      {} as ccc.Client,
    );

    expect(tx.headerDeps).toEqual([depositHeader.hash, withdrawHeader.hash]);
    expect(tx.inputs).toHaveLength(1);
    const since = tx.inputs[0]?.since;
    if (since === undefined) {
      throw new Error("Expected withdrawal input since");
    }
    expect(ccc.Since.from(since).metric).toBe("epoch");
    expect(ccc.Since.from(since).value).toBe(withdrawal.maturity.toNum());
    expect(tx.getWitnessArgsAt(0)?.inputType).toBe(
      ccc.hexFrom(ccc.numLeToBytes(0n, 8)),
    );
  });

  it("preserves an existing non-input witness by shifting it after the new input", async () => {
    vi.spyOn(ccc, "isDaoOutputLimitExceeded").mockResolvedValue(false);

    const manager = new DaoManager(script("11"), []);
    const depositHeader = headerLike(1n);
    const withdrawHeader = headerWithHash(2n, "99");
    const withdrawal: DaoWithdrawalRequestCell = {
      cell: ccc.Cell.from({
        outPoint: { txHash: byte32FromByte("22"), index: 0n },
        cellOutput: {
          capacity: ccc.fixedPointFrom(100082),
          lock: script("33", "0x1234"),
          type: manager.script,
        },
        outputData: ccc.mol.Uint64LE.encode(depositHeader.number),
      }),
      isDeposit: false,
      headers: [{ header: depositHeader }, { header: withdrawHeader }],
      interests: 0n,
      maturity: ccc.Epoch.from([180n, 0n, 1n]),
      isReady: true,
      ckbValue: ccc.fixedPointFrom(100082),
      udtValue: 0n,
    };
    const tx = ccc.Transaction.default();
    const preservedWitness = ccc.WitnessArgs.from({ inputType: "0xab" }).toHex();
    tx.witnesses.push(preservedWitness);

    const updated = await manager.withdraw(tx, [withdrawal], {} as ccc.Client);

    expect(updated.getWitnessArgsAt(0)?.inputType).toBe(
      ccc.hexFrom(ccc.numLeToBytes(0n, 8)),
    );
    expect(updated.witnesses[1]).toBe(preservedWitness);
  });
});
